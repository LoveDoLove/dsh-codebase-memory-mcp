import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodeIntelligenceEngine } from '../src/engine.mjs'
import { CodebaseMemoryClient } from '../src/client.mjs'
import { INDEX_STATUS } from '../src/types.mjs'

test('engine returns degraded status when client is unavailable', async () => {
  const mockClient = new CodebaseMemoryClient({ exePath: '/nonexistent' })
  const engine = new CodeIntelligenceEngine({ client: mockClient })

  const status = await engine.getStatus('/any/repo')
  assert.equal(status.status, INDEX_STATUS.DEGRADED)
  assert.equal(status.degraded, true)

  const sym = await engine.searchSymbols('/any/repo', { query: 'test' })
  assert.equal(sym.ok, false)
  assert.equal(sym.degraded, true)
})

test('engine rejects getCodeSnippet targeting path outside repository boundary', async () => {
  const engine = new CodeIntelligenceEngine({ client: { isAvailable: true } })
  const res = await engine.getCodeSnippet('/repo/root', { file_path: '../../etc/passwd' })
  assert.equal(res.ok, false)
  assert.ok(res.message.includes('outside repository boundary'))
})

test('engine methods (searchSymbols, traceCallPath, getArchitecture, searchCodeText) return degraded when unavailable', async () => {
  const mockClient = new CodebaseMemoryClient({ exePath: '/nonexistent' })
  const engine = new CodeIntelligenceEngine({ client: mockClient })

  const arch = await engine.getArchitecture('/any/repo')
  assert.equal(arch.ok, false)
  assert.equal(arch.degraded, true)

  const trace = await engine.traceCallPath('/any/repo', { symbol: 'myFunc' })
  assert.equal(trace.ok, false)
  assert.equal(trace.degraded, true)

  const text = await engine.searchCodeText('/any/repo', { query: 'import' })
  assert.equal(text.ok, false)
  assert.equal(text.degraded, true)
})
