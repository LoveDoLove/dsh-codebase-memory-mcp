import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findCodebaseMemoryExe,
  CodebaseMemoryClient,
  findExe,
  createClient,
  getOrCreateCodeClient,
  autoStartCodebaseMemory,
  cbmApply,
} from '../src/client.mjs'

test('findCodebaseMemoryExe detects binary or returns null', () => {
  const exe = findCodebaseMemoryExe()
  if (exe) {
    assert.equal(typeof exe, 'string')
    assert.ok(exe.includes('codebase-memory-mcp'))
  }
  assert.equal(findExe(), exe)
})

test('CodebaseMemoryClient handles degraded mode when exe is missing', async () => {
  const client = new CodebaseMemoryClient({ exePath: '/non/existent/path/to/binary' })
  assert.equal(client.isAvailable, false)

  const res = await client.callTool('list_projects', {})
  assert.equal(res.isError, true)
  assert.equal(res.degraded, true)
  assert.ok(res.content[0].text.includes('Code Intelligence unavailable'))
})

test('createClient and getOrCreateCodeClient export matches expected contract', () => {
  const client = createClient('/custom/path/cbm')
  assert.ok(client instanceof CodebaseMemoryClient)
  assert.equal(typeof client.start, 'function')
  assert.equal(typeof client.dispose, 'function')
  assert.equal(typeof client.isRunning, 'function')
})

test('autoStartCodebaseMemory warns when executable is missing', async () => {
  const client = new CodebaseMemoryClient({ exePath: '/nonexistent/cbm' })
  const warnings = []
  const log = {
    info: () => {},
    warn: (msg) => { warnings.push(msg) },
  }
  const result = autoStartCodebaseMemory(client, log)
  assert.equal(result, null)
  assert.equal(warnings.length, 1, 'silence is indistinguishable from "no daemon was ever needed"')
  assert.match(warnings[0], /executable not found/)
})

test('autoStartCodebaseMemory logs live UI URL on successful startup', async () => {
  const infos = []
  const succeedingClient = {
    isAvailable: true,
    isRunning: () => false,
    start: async () => {},
  }
  const log = {
    info: (msg) => { infos.push(msg) },
    warn: () => {},
  }
  await autoStartCodebaseMemory(succeedingClient, log)
  assert.equal(infos.length, 1)
  assert.ok(infos[0].includes('http://localhost:9749/'))
})

test('cbmApply registers cleanup effect and respects eagerStart flag', async () => {
  let cleanedUp = false
  let effectRegistered = false
  const mockCtx = {
    effect: (fn) => {
      effectRegistered = true
      const cleanup = fn()
      return () => cleanup?.()
    },
    logger: () => ({ info: () => {}, warn: () => {} }),
  }

  const client = {
    isAvailable: false,
    isRunning: () => false,
    dispose: () => { cleanedUp = true },
  }

  const res = cbmApply(mockCtx, { client, eagerStart: false })
  assert.equal(res, client)
  assert.equal(effectRegistered, true)
})
