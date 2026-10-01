// Real DSH service integration (same in-process pattern as dsh-univer-office
// test/host-smoke.mjs): boots the actual @deepseek-ai service packages on a
// Cordis Context so registration runs against the real SkillRegistry,
// CommandRuntime, ToolRuntime, and SystemPrompt APIs instead of mocks.
//
// Regression targets:
//   - "/codebase-memory" -> `match.provider.get is not a function`
//     (provider exposed load() instead of get(candidate))
//   - "/cbm" silently unregistered
//     (register() passed execute instead of handler -> normalizeDefinition threw)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getOrCreateClient } from '../src/bridge.mjs'

function resolveDshRoot() {
  const candidates = []
  if (process.env.DSH_ROOT) candidates.push(process.env.DSH_ROOT)
  // Global npm prefix sibling of the running node binary (mise/nvm/npm -g).
  candidates.push(join(dirname(dirname(process.execPath)), 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
  // PATH entries like <prefix>/bin resolve to <prefix>/lib/node_modules/@deepseek-ai/dsh.
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir) candidates.push(join(dir, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'))
  }
  for (const root of candidates) {
    const pkg = join(root, 'package.json')
    if (!existsSync(pkg)) continue
    try {
      if (JSON.parse(readFileSync(pkg, 'utf8')).name === '@deepseek-ai/dsh') return root
    } catch {
      /* keep looking */
    }
  }
  return null
}

const DSH_ROOT = resolveDshRoot()
const skip = DSH_ROOT ? false : 'DSH installation not found (set DSH_ROOT to enable)'

async function importDsh(spec) {
  const requireDsh = createRequire(join(DSH_ROOT, 'package.json'))
  const entry = requireDsh.resolve(spec)
  return import(pathToFileURL(entry).href)
}

const TOOL_NAMES = [
  'cbm_projects',
  'cbm_search',
  'cbm_snippet',
  'cbm_arch',
  'cbm_trace',
  'cbm_search_code',
]

test('real dsh-skill service loads /codebase-memory through provider.get', { skip }, async () => {
  const { Context } = await importDsh('@deepseek-ai/cordis')
  const { default: SkillRegistry } = await importDsh('@deepseek-ai/dsh-skill')
  const { default: SystemPrompt } = await importDsh('@deepseek-ai/dsh-system-prompt')
  const { default: ToolRuntime } = await importDsh('@deepseek-ai/dsh-tools')
  const plugin = await import('../src/index.mjs')

  const ctx = new Context()
  try {
    // ToolRuntime declares static inject = ["systemPrompt"], so system prompt
    // must come first or ctx.tools never appears and apply never runs.
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(plugin)

    const summaries = await ctx.skills.list({})
    assert.ok(
      summaries.some((s) => s.name === 'codebase-memory'),
      'codebase-memory should appear in the skill catalog',
    )

    // This is the exact call that threw `match.provider.get is not a function`.
    const skill = await ctx.skills.get('codebase-memory')
    assert.equal(skill.name, 'codebase-memory')
    assert.equal(skill.provider, 'codebase-memory')
    assert.equal(skill.source, 'bundled')
    assert.equal(typeof skill.content, 'string')
    assert.match(skill.content, /cbm_trace/, 'loaded skill body should keep the SKILL.md content')
    assert.ok(skill.invocation.modelInvocable && skill.invocation.userInvocable)
    assert.match(skill.path, /skills[/\\]codebase-memory[/\\]SKILL\.md$/)
  } finally {
    if (typeof ctx.dispose === 'function') await ctx.dispose()
  }
})

test('real CommandRuntime, SystemPrompt and ToolRuntime accept plugin registration', { skip }, async () => {
  const { Context } = await importDsh('@deepseek-ai/cordis')
  const { default: SkillRegistry } = await importDsh('@deepseek-ai/dsh-skill')
  const { default: ToolRuntime } = await importDsh('@deepseek-ai/dsh-tools')
  const { default: CommandRuntime } = await importDsh('@deepseek-ai/dsh-commands')
  const { default: SystemPrompt } = await importDsh('@deepseek-ai/dsh-system-prompt')
  const plugin = await import('../src/index.mjs')

  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(plugin)

    // /cbm must be registered with the real handler shape.
    const definition = ctx.commands.find(undefined, 'cbm')
    assert.ok(definition, '/cbm command should be registered on the real CommandRuntime')
    assert.equal(typeof definition.handler, 'function')
    const result = await definition.handler({ name: 'cbm', args: [] })
    assert.equal(result.kind, 'success')
    assert.equal(typeof result.text, 'string')
    assert.match(result.text, /Codebase Memory/)

    // System prompt guidance section reaches the real assembly.
    const assembly = await ctx.systemPrompt.assemble({})
    const section = assembly.sections.find((s) => s.name === 'codebase-memory:guidance')
    assert.ok(section, 'codebase-memory:guidance section should be assembled')
    assert.match(section.text, /cbm_trace/)

    // All six tools registered through the real ToolRuntime.
    for (const name of TOOL_NAMES) {
      assert.ok(ctx.tools.get(name), `tool ${name} should be registered`)
    }
  } finally {
    // The /cbm handler lazily spawns the shared MCP daemon child; kill it so
    // the test process can exit (same cleanup as the real-binary test).
    try {
      getOrCreateClient()?.dispose?.();
    } catch {
      /* ignore */
    }
    if (typeof ctx.dispose === 'function') await ctx.dispose()
  }
})

test('plugin disposal reverses every registration and resets the shared client', { skip }, async () => {
  const { Context } = await importDsh('@deepseek-ai/cordis')
  const { default: SkillRegistry } = await importDsh('@deepseek-ai/dsh-skill')
  const { default: ToolRuntime } = await importDsh('@deepseek-ai/dsh-tools')
  const { default: CommandRuntime } = await importDsh('@deepseek-ai/dsh-commands')
  const { default: SystemPrompt } = await importDsh('@deepseek-ai/dsh-system-prompt')
  const plugin = await import('../src/index.mjs')

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(plugin)

  const hasGuidance = async () =>
    !!(await ctx.systemPrompt.assemble({})).sections.find((s) => s.name === 'codebase-memory:guidance')

  assert.ok(ctx.commands.find(undefined, 'cbm'), '/cbm registered before disposal')
  assert.ok(ctx.tools.get('cbm_trace'), 'tools registered before disposal')
  assert.ok(await hasGuidance(), 'guidance section registered before disposal')
  const skillsBefore = await ctx.skills.list({})
  assert.ok(skillsBefore.some((s) => s.name === 'codebase-memory'), 'skill registered before disposal')
  const clientBefore = getOrCreateClient()
  assert.ok(clientBefore, 'shared client exists before disposal')

  ctx.registry.delete(plugin)
  // Fiber unload runs disposers asynchronously (await Promise.resolve() hops
  // inside _unload); let teardown settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.equal(ctx.commands.find(undefined, 'cbm'), undefined, '/cbm removed on disposal')
  assert.equal(ctx.tools.get('cbm_trace'), undefined, 'tools removed on disposal')
  assert.equal(await hasGuidance(), false, 'guidance section removed on disposal')
  const skillsAfter = await ctx.skills.list({})
  assert.ok(!skillsAfter.some((s) => s.name === 'codebase-memory'), 'skill provider removed on disposal')

  // cbmApply's effect disposer must also clear the singleton so a re-apply
  // never hands out a disposed client.
  const clientAfter = getOrCreateClient()
  assert.ok(clientAfter, 'shared client recreated after disposal')
  assert.notEqual(clientAfter, clientBefore, 'shared client instance should be fresh after disposal')
  clientAfter.dispose?.()
})
