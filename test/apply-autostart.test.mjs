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
