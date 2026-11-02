import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCbmToolDefinitions,
  registerCbmTools,
  toRawOutputSchema,
  textBlocks,
  resolveWorkspace,
} from '../src/tools.mjs'
import { CodeIntelligenceEngine } from '../src/engine.mjs'

test('createCbmToolDefinitions includes all 6 code intelligence tools with valid schemas', () => {
  const runtime = {
    fallbackCwd: process.cwd(),
    codeEngine: new CodeIntelligenceEngine({ exePath: '/nonexistent/bin' }),
  }
  const tools = createCbmToolDefinitions(runtime)
  const toolNames = tools.map((t) => t.name)

  assert.ok(toolNames.includes('cbm_projects'))
  assert.ok(toolNames.includes('cbm_search'))
  assert.ok(toolNames.includes('cbm_snippet'))
  assert.ok(toolNames.includes('cbm_trace'))
  assert.ok(toolNames.includes('cbm_arch'))
  assert.ok(toolNames.includes('cbm_search_code'))

  for (const tool of tools) {
    assert.ok(tool.name, 'tool has name')
    assert.ok(tool.description, 'tool has description')
    assert.ok(typeof tool.execute === 'function', 'tool has execute fn')
    assert.ok(typeof tool.presentCall === 'function', 'tool has presentCall fn')
    if (tool.output?.schema) {
      const raw = toRawOutputSchema(tool.output.schema)
      assert.equal(typeof raw, 'object')
    }
  }
})

test('cbm_projects handles degraded mode gracefully', async () => {
  const tools = new Map(
    createCbmToolDefinitions({
      codeEngine: new CodeIntelligenceEngine({ exePath: '/nonexistent/bin' }),
    }).map((t) => [t.name, t]),
  )

  const projectsTool = tools.get('cbm_projects')
  const projectsRes = await projectsTool.execute({ reason: 'testing' }, {})
  assert.equal(projectsRes.ok, false)
  assert.equal(projectsRes.degraded, true)
  const renderedProjects = projectsTool.output.render({}, projectsRes)
  assert.match(renderedProjects[0].text, /Code Intelligence Degraded/)
})

test('textBlocks returns array with text property', () => {
  const res = textBlocks('hello')
  assert.deepEqual(res, [{ type: 'text', text: 'hello' }])
})

test('resolveWorkspace falls back to process.cwd()', () => {
  const ws = resolveWorkspace({})
  assert.equal(typeof ws, 'string')
  assert.ok(ws.length > 0)
})
