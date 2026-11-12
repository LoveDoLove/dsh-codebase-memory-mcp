/**
 * Veyra Code Intelligence — Upstream MCP IPC Client & Degraded Adapter.
 *
 * Communicates with the native codebase-memory-mcp executable via stdio JSON-RPC 2.0.
 * Implements:
 *   - Executable discovery (PATH, ~/.local/bin, env vars, WSL)
 *   - Child process lifecycle and MCP initialization handshake
 *   - Line-delimited JSON-RPC framing with timeouts
 *   - Automatic restart on unexpected process termination
 *   - Degraded mode fallback when binary is missing or fails (Memory stays active)
 *   - Safe disposal and process shutdown
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DEFAULT_UI_PORT } from './types.mjs'

/**
 * Cancellation must be identifiable by name: the tool pipeline records a call
 * as ABORTED by checking for `AbortError`, not by message text.
 */
function abortError(method) {
  const err = new Error(`codebase-memory-mcp rpc aborted: ${method}`)
  err.name = 'AbortError'
  return err
}

/**
 * Locate the codebase-memory-mcp executable.
 */
export function findCodebaseMemoryExe(env = process.env) {
  if (env.CBM_EXE && existsSync(env.CBM_EXE)) {
    return env.CBM_EXE
  }
  if (env.CODEBASE_MEMORY_EXE && existsSync(env.CODEBASE_MEMORY_EXE)) {
    return env.CODEBASE_MEMORY_EXE
  }

  const isWin = process.platform === 'win32'
  const exeName = isWin ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp'
  const home = homedir()

  const candidates = isWin
    ? [
        join(home, 'AppData', 'Local', 'Programs', 'codebase-memory-mcp', exeName),
        join(process.cwd(), exeName),
      ]
    : [
        join(home, '.local', 'bin', exeName),
        join('/usr/local/bin', exeName),
        join('/usr/bin', exeName),
        join(process.cwd(), exeName),
      ]

  for (const c of candidates) {
    if (existsSync(c)) return c
  }

  // Search PATH
  const pathEnv = (env.PATH || '').split(delimiter)
  for (const dir of pathEnv) {
    if (!dir) continue
    const target = join(dir, exeName)
    if (existsSync(target)) return target
  }

  // Cross-WSL check: if running inside Linux/WSL, check if Windows executable is reachable
  if (!isWin && existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
    const winExeName = 'codebase-memory-mcp.exe'
    for (const dir of pathEnv) {
      if (!dir) continue
      const target = join(dir, winExeName)
      if (existsSync(target)) return target
    }
  }

  return null
}

export class CodebaseMemoryClient {
  constructor(opts = {}) {
    this.exePath = opts.exePath || findCodebaseMemoryExe(opts.env)
    this.uiEnabled = opts.uiEnabled ?? true
    this.port = opts.port || DEFAULT_UI_PORT
    this.logger = opts.logger || console
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
    this.startPromise = null
    this.serverInfo = null
    this.isDisposed = false
  }

  get isAvailable() {
    return Boolean(this.exePath && existsSync(this.exePath))
  }

  async ensureStarted() {
    if (this.isDisposed) {
      throw new Error('CodebaseMemoryClient is disposed')
    }
    if (!this.isAvailable) {
      throw new Error('codebase-memory-mcp executable not found')
    }
    if (this.child && !this.child.killed && this.child.exitCode === null) return
    if (this.startPromise) return this.startPromise

    this.startPromise = (async () => {
      const args = []
      if (this.uiEnabled) {
        args.push('--ui=true', `--port=${this.port}`)
      } else {
        args.push('--ui=false')
      }

      this.child = spawn(this.exePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      this.child.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8')
        this.flushBuffer()
      })

      this.child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8').trim()
        if (text && !text.includes('warning:')) {
          this.logger.debug?.(`[cbm-stderr] ${text}`)
        }
      })

      this.child.on('error', (err) => {
        this.logger.warn?.(`[cbm-proc] error: ${err.message}`)
        this.rejectAllPending(err)
      })

      this.child.on('close', (code) => {
        this.rejectAllPending(new Error(`codebase-memory-mcp process closed (code: ${code})`))
        this.child = null
        this.startPromise = null
      })

      // MCP initialize handshake
      const initId = this.nextId++
      const initPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(initId)
          reject(new Error('codebase-memory-mcp initialize timeout (30s)'))
        }, 30_000)
        this.pending.set(initId, { resolve, reject, timer })
      })

      this.child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'veyra-code-intelligence', version: '0.1.0' },
          },
        }) + '\n'
      )

      const initResult = await initPromise
      if (initResult?.serverInfo) {
        this.serverInfo = initResult.serverInfo
      }

      // Complete initialization notification
      this.child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }) + '\n'
      )

      this.startPromise = null
    })().catch((err) => {
      this.startPromise = null
      this.stop()
      throw err
    })

    return this.startPromise
  }

  flushBuffer() {
    let newlineIdx
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim()
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (!line) continue

      try {
        const msg = JSON.parse(line)
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id)
          clearTimeout(timer)
          this.pending.delete(msg.id)

          if (msg.error) {
            reject(new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`))
          } else {
            resolve(msg.result)
          }
        }
      } catch {
        // Discard malformed JSON lines
      }
    }
  }

  rejectAllPending(err) {
    for (const [id, { reject, timer }] of this.pending.entries()) {
      clearTimeout(timer)
      reject(err)
    }
    this.pending.clear()
  }

  async rpc(method, params = {}, timeoutMs = 60_000, signal = undefined) {
    if (signal?.aborted) throw abortError(method)
    await this.ensureStarted()
    const id = this.nextId++

    return new Promise((resolve, reject) => {
      // Every settle path (response, timeout, abort, write failure) must clear
      // the timer, drop the pending entry, and unhook the abort listener.
      const finish = (fn, value) => {
        clearTimeout(timer)
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        fn(value)
      }
      const timer = setTimeout(() => {
        finish(reject, new Error(`codebase-memory-mcp rpc timeout: ${method}`))
      }, timeoutMs)
      const onAbort = () => {
        finish(reject, abortError(method))
      }

      this.pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (err) => finish(reject, err),
        timer,
      })
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      } catch (err) {
        finish(reject, err)
      }
    })
  }

  async callTool(toolName, args = {}, signal) {
    if (signal?.aborted) throw abortError('tools/call')
    if (!this.isAvailable) {
      return {
        isError: true,
        degraded: true,
        content: [{ type: 'text', text: `Code Intelligence unavailable: codebase-memory-mcp binary not found. Install via 'curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash' or set CBM_EXE. Veyra Memory remains fully functional.` }],
      }
    }

    try {
      const result = await this.rpc('tools/call', {
        name: toolName,
        arguments: args,
      }, 60_000, signal)
      return result
    } catch (err) {
      // Cancellation is not a degraded result: the tool contract requires
      // AbortError to propagate so the registry records ABORTED.
      if (err?.name === 'AbortError') throw err
      this.logger.warn?.(`[cbm-client] tool ${toolName} failed: ${err.message}`)
      return {
        isError: true,
        degraded: true,
        content: [{ type: 'text', text: `Code Intelligence degraded: ${err.message}` }],
      }
    }
  }

  /**
   * Compatibility wrapper for raw text output or error throw.
   */
  async call(name, args = {}, signal) {
    const r = await this.rpc('tools/call', { name, arguments: args }, 60_000, signal)
    if (r?.isError) {
      const parts = (r.content || []).map((c) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c)))
      throw new Error(parts.join('\n') || `codebase-memory tool failed: ${name}`)
    }
    const text = (r?.content || []).map((c) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c))).join('\n')
    return text || '{}'
  }

  async indexRepository(repoPath, project, mode = 'fast', signal) {
    const args = { repo_path: repoPath, mode }
    if (project) args.name = project
    return this.callTool('index_repository', args, signal)
  }

  async searchGraph(args = {}, signal) {
    return this.callTool('search_graph', args, signal)
  }

  async tracePath(args = {}, signal) {
    const payload = {
      project: args.project,
      function_name: args.function_name || args.symbol || '',
      direction: args.direction || 'both',
      depth: args.depth || args.max_depth || args.maxDepth || 3,
    }
    return this.callTool('trace_path', payload, signal)
  }

  async getCodeSnippet(args = {}, signal) {
    const payload = {
      project: args.project,
      qualified_name: args.qualified_name || args.qualifiedName || args.symbol || '',
    }
    if (args.start_line || args.startLine) payload.start_line = args.start_line || args.startLine
    if (args.max_lines || args.maxLines) payload.max_lines = args.max_lines || args.maxLines
    return this.callTool('get_code_snippet', payload, signal)
  }

  async getArchitecture(args = {}, signal) {
    const payload = {
      project: args.project,
      path: args.path || args.directory || '',
    }
    if (args.aspects) payload.aspects = args.aspects
    return this.callTool('get_architecture', payload, signal)
  }

  async searchCode(args = {}, signal) {
    const payload = {
      project: args.project,
      pattern: args.pattern || args.query || '',
    }
    if (args.file_pattern || args.filePattern) payload.file_pattern = args.file_pattern || args.filePattern
    if (args.limit) payload.limit = args.limit
    return this.callTool('search_code', payload, signal)
  }

  async listProjects(signal) {
    return this.callTool('list_projects', {}, signal)
  }

  async indexStatus(project, signal) {
    return this.callTool('index_status', { project }, signal)
  }

  async detectChanges(project, signal) {
    return this.callTool('detect_changes', { project }, signal)
  }

  async checkIndexCoverage(project, signal) {
    return this.callTool('check_index_coverage', { project }, signal)
  }

  start() {
    return this.ensureStarted()
  }

  dispose() {
    this.stop()
    if (sharedClient === this) {
      sharedClient = null
    }
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null)
  }

  stop() {
    this.isDisposed = true
    if (this.child) {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // ignore
      }
      this.child = null
    }
    this.rejectAllPending(new Error('CodebaseMemoryClient stopped'))
  }
}

let sharedClient = null

export function getOrCreateCodeClient(opts = {}) {
  if (!sharedClient || sharedClient.isDisposed) {
    sharedClient = new CodebaseMemoryClient(opts)
  }
  return sharedClient
}

export function resetSharedCodeClient() {
  if (sharedClient) {
    sharedClient.stop()
    sharedClient = null
  }
}

export const findExe = findCodebaseMemoryExe
export const getOrCreateClient = getOrCreateCodeClient

export function createClient(exePath, opts = {}) {
  return new CodebaseMemoryClient({ exePath, ...opts })
}

export function autoStartCodebaseMemory(clientOrOpts = getOrCreateClient(), log = console) {
  let client, logger
  if (clientOrOpts && typeof clientOrOpts.start === 'function') {
    client = clientOrOpts
    logger = log
  } else {
    client = clientOrOpts?.client || getOrCreateClient(clientOrOpts)
    logger = clientOrOpts?.log || log
  }
  // A Cordis ctx.logger on a `dsh web` boot has no console exporter, so a
  // banner sent through it is invisible. Write to stderr as well: stdout is
  // the ACP protocol stream in some profiles.
  const announce = (msg) => {
    try { process.stderr.write(`${msg}\n`) } catch { /* stream closed */ }
  }

  // Staying silent here would leave the user unable to tell "no daemon because
  // it is broken" from "no daemon because it was never installed".
  if (!client) return null
  if (!client.isAvailable) {
    const msg = '\x1b[33m[codebase-memory]\x1b[0m codebase-memory-mcp executable not found; the graph UI stays off. Install codebase-memory-mcp or set CBM_EXE.'
    announce(msg)
    if (typeof logger?.warn === 'function') logger.warn(msg)
    return null
  }
  if (client.isRunning?.()) return null

  return client
    .start()
    .then(() => {
      const msg = `\x1b[36m[codebase-memory]\x1b[0m 🔍 \x1b[1mcodebase-memory UI is live:\x1b[0m \x1b[32mhttp://localhost:${client.port || DEFAULT_UI_PORT}/\x1b[0m`
      announce(msg)
      if (typeof logger?.info === 'function') logger.info(msg)
      else if (typeof logger?.log === 'function') logger.log(msg)
    })
    .catch((err) => {
      const msg = `[codebase-memory] codebase-memory-mcp failed to start: ${err.message}`
      announce(msg)
      if (typeof logger?.warn === 'function') logger.warn(msg)
    })
}

export function cbmApply(ctx, opts = {}) {
  const client = opts.client || getOrCreateClient(opts)
  if (!client) return null

  ctx.effect?.(() => () => {
    client.dispose?.()
    if (sharedClient === client) sharedClient = null
  })

  const isTest =
    process.env.NODE_ENV === 'test' ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test') ||
    process.argv.some((arg) => typeof arg === 'string' && (arg.endsWith('.test.mjs') || arg.endsWith('.test.js')))

  const shouldStart = opts.eagerStart !== undefined ? Boolean(opts.eagerStart) : !isTest

  // autoStartCodebaseMemory owns the availability and already-running checks,
  // plus the stderr notice when the executable is missing.
  if (shouldStart) autoStartCodebaseMemory(client, ctx.logger?.('codebase-memory') || console)

  return client
}
