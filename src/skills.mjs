/**
 * codebase-memory — bundled DSH skills.
 *
 * Ships skills/<name>/SKILL.md for each entry in BUNDLED_SKILL_DEFINITIONS
 * and registers them as a native bundled provider so the model-facing
 * `skill` tool can load them. Matches the Veyra pattern:
 * ctx.skills.registerProvider at rank 600, source "bundled".
 *
 * Also exposes registerRuntimeSkill() for hosts that only have
 * ctx.skills.register (no provider API).
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(PLUGIN_ROOT, '..')

export const BUNDLED_SKILL_RANK = 600
export const SKILL_PROVIDER_NAME = 'codebase-memory'
export const SKILL_INVOCATION = Object.freeze({
  modelInvocable: true,
  userInvocable: true,
})

export const BUNDLED_SKILL_DEFINITIONS = Object.freeze([
  {
    name: 'codebase-memory',
    description:
      'Use Codebase Memory for structural code intelligence, AST-level navigation, '
      + 'call-graph tracing, and knowledge-graph code search. Prefer cbm_trace for '
      + 'caller/callee analysis, cbm_search for symbol discovery, cbm_snippet for '
      + 'exact definitions, and cbm_arch for component dependency overview. '
      + 'Provides precise structural graph vs noisy text search.',
    whenToUse:
      'Call hierarchies, blast-radius analysis, symbol search, definition retrieval, '
      + 'component architecture, dependency tracing, refactoring impact analysis.',
  },
])

function skillFileFor(name) {
  return join(REPO_ROOT, 'skills', name, 'SKILL.md')
}

function stripSkillFrontmatter(raw) {
  return String(raw ?? '').replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
}

function unquote(val) {
  if (
    (val.startsWith('"') && val.endsWith('"'))
    || (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1)
  }
  return val
}

/**
 * Tiny YAML subset used by SKILL.md frontmatter: `key: value`, quoted
 * scalars, and `>` / `|` block scalars. Good enough for DSH skill files.
 */
export function parseFrontmatter(block) {
  const out = {}
  const lines = String(block ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const idx = line.indexOf(':')
    if (idx <= 0 || /^\s/.test(line)) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (val === '>' || val === '|' || val === '>-' || val === '|-') {
      const folded = val.startsWith('>')
      const collected = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        i += 1
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      val = folded
        ? collected.join(' ').replace(/\s+/g, ' ').trim()
        : collected.join('\n').trim()
    } else {
      val = unquote(val)
    }
    out[key] = val
  }
  return out
}

/**
 * Parse a SKILL.md into the fields ctx.skills.register() accepts.
 * Used by tests and the runtime-register fallback.
 */
export function parseSkillMarkdown(raw, fallbackName = 'codebase-memory') {
  const text = String(raw ?? '')
  const fmMatch = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  const meta = fmMatch ? parseFrontmatter(fmMatch[1]) : {}
  return {
    name: meta.name || fallbackName,
    description: (meta.description || '').replace(/\s+/g, ' ').trim(),
    whenToUse: (meta.whenToUse || '').replace(/\s+/g, ' ').trim() || undefined,
    content: stripSkillFrontmatter(text),
    source: 'bundled',
    path: skillFileFor(meta.name || fallbackName),
  }
}

export function createBundledSkillProvider() {
  const candidates = BUNDLED_SKILL_DEFINITIONS.map((def) => {
    const dir = dirname(skillFileFor(def.name))
    return {
      name: def.name,
      description: def.description,
      whenToUse: def.whenToUse,
      source: 'bundled',
      path: skillFileFor(def.name),
      exists: existsSync(dir),
      invocation: SKILL_INVOCATION,
      provider: SKILL_PROVIDER_NAME,
    }
  })

  return {
    name: SKILL_PROVIDER_NAME,
    rank: BUNDLED_SKILL_RANK,
    async list() {
      return candidates.filter((c) => c.exists)
    },
    async load(name) {
      const candidate = candidates.find((c) => c.name === name)
      if (!candidate || !candidate.exists) return null
      const raw = await readFile(candidate.path, 'utf8')
      const parsed = parseSkillMarkdown(raw, candidate.name)
      return {
        name: parsed.name,
        description: parsed.description || candidate.description,
        whenToUse: parsed.whenToUse || candidate.whenToUse,
        content: parsed.content,
        source: 'bundled',
        path: candidate.path,
        invocation: candidate.invocation,
        provider: SKILL_PROVIDER_NAME,
      }
    },
  }
}

/**
 * Register the bundled codebase-memory skill on a DSH skills service.
 * Prefers registerProvider (catalog + on-demand load). Falls back to
 * register() with the body already loaded. Returns the registered names.
 */
export async function registerSkills(ctx, log) {
  const skills = ctx?.skills
  if (!skills) return []

  if (typeof skills.registerProvider === 'function') {
    const provider = createBundledSkillProvider()
    skills.registerProvider(() => provider)
    return provider.list().then((candidates) => candidates.map((c) => c.name))
  }

  if (typeof skills.register === 'function') {
    const names = []
    for (const def of BUNDLED_SKILL_DEFINITIONS) {
      const file = skillFileFor(def.name)
      const raw = await readFile(file, 'utf8')
      const parsed = parseSkillMarkdown(raw, def.name)
      skills.register({
        name: parsed.name,
        description: parsed.description || def.description,
        whenToUse: parsed.whenToUse || def.whenToUse,
        content: parsed.content,
        source: 'bundled',
        path: file,
        invocation: SKILL_INVOCATION,
        provider: SKILL_PROVIDER_NAME,
      })
      names.push(parsed.name)
    }
    return names
  }

  log?.debug?.('[codebase-memory] skills service has no register/registerProvider')
  return []
}

/**
 * Runtime-register fallback for tests or standalone usage.
 */
export async function registerRuntimeSkill(ctx, name) {
  if (!ctx?.skills?.register) return null
  const def = BUNDLED_SKILL_DEFINITIONS.find((d) => d.name === name)
  if (!def) return null
  const file = skillFileFor(def.name)
  const raw = await readFile(file, 'utf8')
  const parsed = parseSkillMarkdown(raw, def.name)
  ctx.skills.register({
    name: parsed.name,
    description: parsed.description || def.description,
    whenToUse: parsed.whenToUse || def.whenToUse,
    content: parsed.content,
    source: 'bundled',
    path: file,
    invocation: SKILL_INVOCATION,
    provider: SKILL_PROVIDER_NAME,
  })
  return parsed.name
}
