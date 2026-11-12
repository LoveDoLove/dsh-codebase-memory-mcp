import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// --- cancellation contract ---

const slowMcpServer = () => [
  '#!/usr/bin/env node',
  'let buf = "";',
  'process.stdin.on("data", (d) => {',
  '  buf += d;',
  '  let i;',
  '  while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {',
  '    const line = buf.slice(0, i).trim();',
  '    buf = buf.slice(i + 1);',
  '    if (!line) continue;',
  '    const msg = JSON.parse(line);',
  "    if (msg.method === 'initialize') {",
  "      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'slow-cbm' } } }));",
  '    }',
  '    // a tools/call with name slow_tool is deliberately never answered',
  '  }',
  '});',
  '',
].join('\n')

test('rpc rejects with AbortError when the signal is already aborted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-abort-'))
  const exe = join(dir, 'slow-cbm-mcp')
  writeFileSync(exe, slowMcpServer())
  execSync(`chmod +x "${exe}"`)
  const client = createClient(exe)
  const controller = new AbortController()
  controller.abort()
  try {
    await assert.rejects(
      () => client.rpc('tools/call', { name: 'slow_tool', arguments: {} }, 60_000, controller.signal),
      (err) => err.name === 'AbortError',
    )
  } finally {
    client.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rpc aborts an in-flight call promptly and leaves no pending entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-abort2-'))
  const exe = join(dir, 'slow-cbm-mcp')
  writeFileSync(exe, slowMcpServer())
  execSync(`chmod +x "${exe}"`)
  const client = createClient(exe)
  const controller = new AbortController()
  try {
    const pending = client.rpc('tools/call', { name: 'slow_tool', arguments: {} }, 60_000, controller.signal)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(client.pending.size, 1, 'call should be awaiting a response')

    const started = Date.now()
    controller.abort()
    await assert.rejects(pending, (err) => err.name === 'AbortError')
    // The rpc timeout is 60s; returning in well under that proves the abort
    // path fired rather than a timeout.
    assert.ok(Date.now() - started < 2_000, 'abort must not wait for the rpc timeout')
    assert.equal(client.pending.size, 0, 'aborted entry must not linger')
  } finally {
    client.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('callTool propagates AbortError instead of returning a degraded result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-abort3-'))
  const exe = join(dir, 'slow-cbm-mcp')
  writeFileSync(exe, slowMcpServer())
  execSync(`chmod +x "${exe}"`)
  const client = createClient(exe)
  const controller = new AbortController()
  try {
    const pending = client.callTool('slow_tool', {}, controller.signal)
    await new Promise((r) => setTimeout(r, 100))
    controller.abort()
    await assert.rejects(pending, (err) => err.name === 'AbortError')
  } finally {
    client.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
