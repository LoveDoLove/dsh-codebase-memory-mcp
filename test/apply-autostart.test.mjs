// Regression: 0.1.5 rewrote apply() to register tools only and dropped the
// eager `start()` that used to live in cbmApply(). dsh web then booted with no
// daemon and no UI on http://localhost:9749/ until an agent happened to call a
// cbm_* tool.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.mjs'
import { resetSharedCodeClient } from '../src/client.mjs'

function fakeMcpServer(marker) {
  return [
    '#!/usr/bin/env node',
    "const fs = require('node:fs')",
    `fs.writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '))`,
    "let buf = ''",
    "process.stdin.on('data', (d) => {",
    '  buf += d',
    '  let i',
    "  while ((i = buf.indexOf('\\n')) >= 0) {",
    '    const line = buf.slice(0, i).trim()',
    '    buf = buf.slice(i + 1)',
    '    if (!line) continue',
    '    const msg = JSON.parse(line)',
    "    if (msg.method === 'initialize') {",
    "      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake-cbm' } } }))",
    '    }',
    '  }',
    '})',
    '',
  ].join('\n')
}

function mockCtx() {
  const ctx = {
    tools: { register: () => {} },
    effect: (fn) => fn(),
    inject: (_deps, fn) => fn(ctx),
    logger: () => ({ info: () => {}, warn: () => {}, debug: () => {} }),
    systemPrompt: { section: () => {} },
    skills: { registerProvider: (fn) => fn() },
    commands: { register: () => {} },
  }
  return ctx
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

test('plugin apply auto-starts the daemon with the graph UI enabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-autostart-'))
  const exe = join(dir, 'codebase-memory-mcp')
  const marker = join(dir, 'spawned.txt')
  writeFileSync(exe, fakeMcpServer(marker))
  execSync(`chmod +x "${exe}"`)

  const prevExe = process.env.CBM_EXE
  process.env.CBM_EXE = exe
  resetSharedCodeClient()

  try {
    apply(mockCtx(), { eagerStart: true })

    const spawned = await waitFor(() => existsSync(marker), 10_000)
    assert.ok(spawned, 'apply() must spawn codebase-memory-mcp; the fake server never started')

    const args = readFileSync(marker, 'utf8')
    assert.match(args, /--ui=true/, 'UI must be enabled so http://localhost:9749/ serves the graph')
    assert.match(args, /--port=9749/, 'UI must bind the documented port')
  } finally {
    resetSharedCodeClient()
    if (prevExe === undefined) delete process.env.CBM_EXE
    else process.env.CBM_EXE = prevExe
    rmSync(dir, { recursive: true, force: true })
  }
})

// `dsh web` boots with a Cordis ctx.logger whose exporters never reach the
// terminal: the only exporter DSH installs on a web boot collects warn/error
// for the startup-error report. A banner sent through ctx.logger is therefore
// invisible, which is why the daemon could be up while the user saw nothing.
// The startup notice must reach a real stream, and it must be stderr because
// ACP profiles frame their protocol on stdout.
function captureStderr() {
  const chunks = []
  const original = process.stderr.write
  process.stderr.write = (chunk, ...rest) => {
    chunks.push(String(chunk))
    return original.call(process.stderr, chunk, ...rest)
  }
  return {
    text: () => chunks.join(''),
    restore: () => { process.stderr.write = original },
  }
}

test('apply() announces the daemon on stderr, not only through ctx.logger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-announce-'))
  const exe = join(dir, 'codebase-memory-mcp')
  const marker = join(dir, 'spawned.txt')
  writeFileSync(exe, fakeMcpServer(marker))
  execSync(`chmod +x "${exe}"`)

  const prevExe = process.env.CBM_EXE
  process.env.CBM_EXE = exe
  resetSharedCodeClient()
  const stderr = captureStderr()

  try {
    apply(mockCtx(), { eagerStart: true })

    const announced = await waitFor(() => /9749/.test(stderr.text()), 10_000)
    assert.ok(
      announced,
      'a user watching `dsh web` must see the daemon start; ctx.logger alone is invisible',
    )
    assert.match(stderr.text(), /codebase-memory/, 'the notice must name the plugin')
  } finally {
    stderr.restore()
    resetSharedCodeClient()
    if (prevExe === undefined) delete process.env.CBM_EXE
    else process.env.CBM_EXE = prevExe
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- Config schema ---

test('plugin exports a schemastery Config with documented defaults', async () => {
  const mod = await import('../src/index.mjs')
  const { Config } = mod.default
  assert.ok(Config, 'the default export must carry Config so cordis can validate cordis.yml')
  assert.equal(typeof Config.simplify, 'function', 'Config must be a schemastery schema')

  // Cordis validates plugin config through the Standard Schema interface.
  const { value, issues } = Config['~standard'].validate({})
  assert.equal(issues, undefined)
  assert.equal(value.uiEnabled, true)
  assert.equal(value.port, 9749)
  assert.equal(value.eagerStart, true)
  assert.equal(value.exePath, undefined, 'exePath stays unset so discovery can take over')
})

test('Config rejects a non-numeric port instead of coercing it', async () => {
  const { Config } = (await import('../src/index.mjs')).default
  const { issues } = Config['~standard'].validate({ port: 'not-a-port' })
  assert.ok(issues?.length, 'an invalid port must be reported, not silently accepted')
})

test('apply() honours a configured port in the daemon args and the banner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-port-'))
  const exe = join(dir, 'codebase-memory-mcp')
  const marker = join(dir, 'spawned.txt')
  writeFileSync(exe, fakeMcpServer(marker))
  execSync(`chmod +x "${exe}"`)

  const prevExe = process.env.CBM_EXE
  process.env.CBM_EXE = exe
  resetSharedCodeClient()
  const stderr = captureStderr()

  try {
    apply(mockCtx(), { eagerStart: true, port: 8123 })

    const announced = await waitFor(() => /8123/.test(stderr.text()), 10_000)
    assert.ok(announced, 'the startup notice must advertise the configured port')
    assert.match(readFileSync(marker, 'utf8'), /--port=8123/, 'the daemon must bind the configured port')
  } finally {
    stderr.restore()
    resetSharedCodeClient()
    if (prevExe === undefined) delete process.env.CBM_EXE
    else process.env.CBM_EXE = prevExe
    rmSync(dir, { recursive: true, force: true })
  }
})
