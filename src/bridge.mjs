import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let defineToolFn = (spec) => spec;
try {
  const dshTools = require('@deepseek-ai/dsh-tools');
  if (typeof dshTools.defineTool === 'function') {
    defineToolFn = dshTools.defineTool;
  }
} catch {
  // Use pass-through if @deepseek-ai/dsh-tools is not installed
}

/**
 * Derive codebase-memory-mcp project name from repository root path.
 * Windows: C:\path\to\repo -> C-path-to-repo
 * Linux/WSL: /home/user/repo -> home-user-repo
 */
export function projectNameFromPath(p) {
  const norm = String(p).replace(/\\/g, '/');
  const isWindows = /^[A-Za-z]:/.test(norm);
  const withoutDrive = norm.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '');
  const slug = withoutDrive.replace(/\//g, '-');
  return isWindows ? `C-${slug}` : slug;
}

/**
 * Create a persistent JSON-RPC 2.0 client talking to codebase-memory-mcp via stdio.
 * Automatically enables HTTP graph visualization UI at http://localhost:9749/ (--ui=true).
 */
export function createClient(exePath) {
  let child = null;
  let nextId = 1;
  const pending = new Map();
  let buffer = '';
  let startPromise = null;

  const ensureStarted = async () => {
    if (child && !child.killed) return;
    if (startPromise) return startPromise;

    startPromise = (async () => {
      child = spawn(exePath, ['--ui=true'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.id && pending.has(msg.id)) {
              const { resolve, reject, timer } = pending.get(msg.id);
              clearTimeout(timer);
              pending.delete(msg.id);
              if (msg.error) {
                reject(new Error(msg.error.message || `RPC error: ${JSON.stringify(msg.error)}`));
              } else {
                resolve(msg.result);
              }
            }
          } catch {
            // Ignore non-JSON output (e.g. server diagnostics or banner messages)
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text && !text.includes('Progress:')) {
          // Output to stderr is diagnostics or progress, silently ignore or debug
        }
      });

      child.on('error', (err) => {
        for (const [, p] of pending) {
          clearTimeout(p.timer);
          p.reject(err);
        }
        pending.clear();
        child = null;
        startPromise = null;
      });

      child.on('exit', () => {
        for (const [, p] of pending) {
          clearTimeout(p.timer);
          p.reject(new Error('codebase-memory process exited'));
        }
        pending.clear();
        child = null;
        startPromise = null;
      });

      // Handshake: MCP initialize
      const initId = nextId++;
      const initPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(initId);
          reject(new Error('codebase-memory initialize timeout (30s)'));
        }, 30_000);
        pending.set(initId, { resolve, reject, timer });
      });

      const c = child;
      c.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'dsh-codebase-memory', version: '0.1.0' },
          },
        }) + '\n'
      );

      await initPromise;

      // Complete initialization handshake
      c.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }) + '\n'
      );

      startPromise = null;
    })().catch((e) => {
      startPromise = null;
      throw e;
    });

    return startPromise;
  };

  const rpc = async (method, params = {}) => {
    await ensureStarted();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`codebase-memory rpc timeout: ${method}`));
      }, 120_000);
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  };

  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    if (r?.isError) {
      const parts = (r.content || []).map((c) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c)));
      throw new Error(parts.join('\n') || `codebase-memory tool failed: ${name}`);
    }
    const text = (r?.content || []).map((c) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c))).join('\n');
    return text || '{}';
  };

  const dispose = () => {
    for (const [, p] of pending) clearTimeout(p.timer);
    pending.clear();
    if (child && !child.killed) child.kill();
    child = null;
    startPromise = null;
  };

  const start = () => ensureStarted();

  return {
    rpc,
    call,
    dispose,
    start,
    isRunning: () => !!child && !child.killed,
  };
}

/**
 * Locate codebase-memory-mcp executable across platforms.
 * Priority:
 * 1. CBM_EXE environment variable
 * 2. Standard user directory (~/.local/bin or AppData/Local/Programs)
 * 3. System directories (/usr/local/bin, /usr/bin)
 * 4. Current working directory
 * 5. PATH lookup
 */
export function findExe() {
  if (process.env.CBM_EXE && existsSync(process.env.CBM_EXE)) {
    return process.env.CBM_EXE;
  }

  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  const homedir = os.homedir();

  const candidates = isWin
    ? [
        path.join(homedir, 'AppData', 'Local', 'Programs', 'codebase-memory-mcp', exeName),
        path.join(process.cwd(), exeName),
      ]
    : [
        path.join(homedir, '.local', 'bin', exeName),
        path.join('/usr/local/bin', exeName),
        path.join('/usr/bin', exeName),
        path.join(process.cwd(), exeName),
      ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Search PATH
  const pathEnv = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathEnv) {
    if (!dir) continue;
    const exe = path.join(dir, exeName);
    if (existsSync(exe)) return exe;
  }

  // Cross-WSL check: if running inside Linux/WSL, check if Windows executable is reachable
  if (!isWin && existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
    const winExeName = 'codebase-memory-mcp.exe';
    for (const dir of pathEnv) {
      if (!dir) continue;
      const exe = path.join(dir, winExeName);
      if (existsSync(exe)) return exe;
    }
  }

  return null;
}

export const EXE = findExe();

let sharedClient = null;

/**
 * Get or create the shared singleton client instance.
 */
export function getOrCreateClient() {
  if (!sharedClient) {
    const exe = findExe();
    if (exe) {
      sharedClient = createClient(exe);
    }
  }
  return sharedClient;
}

/**
 * Eagerly start codebase-memory-mcp daemon on plugin load.
 */
export function autoStartCodebaseMemory() {
  const client = getOrCreateClient();
  if (client) {
    client
      .start()
      .then(() => {
        console.log('\x1b[36m[codebase-memory]\x1b[0m 🔍 \x1b[1mcodebase-memory UI is live:\x1b[0m \x1b[32mhttp://localhost:9749/\x1b[0m');
      })
      .catch((err) => {
        console.warn('[codebase-memory] codebase-memory-mcp failed to start:', err.message);
      });
  }
}

/**
 * Register cbm_* tools onto ctx.tools using defineTool (if available) or pass-through.
 */
export function registerCbmTools(ctx, client) {
  const withProject = (args) => {
    const a = { ...args };
    if (a.project === undefined && a.repo) a.project = projectNameFromPath(a.repo);
    if (a.project === undefined && process.env.CBM_DEFAULT_PROJECT) a.project = process.env.CBM_DEFAULT_PROJECT;
    if (a.project === undefined && process.cwd()) a.project = projectNameFromPath(process.cwd());
    return a;
  };

  const register = (spec) => {
    const toolObj = defineToolFn({
      ...spec,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      isConcurrencySafe: () => true,
    });
    return ctx.effect(() => ctx.tools.register(toolObj), `codebase-memory.cbm.${spec.name}`);
  };

  register({
    name: 'cbm_projects',
    description: 'List all projects currently indexed in codebase-memory-mcp.',
    parameters: { type: 'object', properties: {} },
    execute: async () => client.call('list_projects', {}),
  });

  register({
    name: 'cbm_search',
    description:
      'Search the code knowledge graph for symbols, functions, classes, or files. Filter by name_pattern, label (Function, Class, Interface, File), or degree.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name (e.g. C-repos-myproject). Defaults to current repo.' },
        repo: { type: 'string', description: 'Repository root path as fallback if project name not known.' },
        name_pattern: { type: 'string', description: 'Regex/substring to filter node names (e.g. ".*auth.*").' },
        label: { type: 'string', description: 'Node label filter: Function | Class | Interface | File' },
        file_path_pattern: { type: 'string', description: 'Regex to filter by file path.' },
        limit: { type: 'number', description: 'Maximum results to return (default 50).' },
      },
    },
    execute: async (args) => {
      const a = withProject(args);
      if (!a.project) throw new Error('Missing project: provide project or repo path');
      return client.call('search_graph', {
        project: a.project,
        name_pattern: a.name_pattern,
        label: a.label,
        file_path_pattern: a.file_path_pattern,
        limit: a.limit,
      });
    },
  });

  register({
    name: 'cbm_snippet',
    description: 'Fetch the exact source code snippet for a qualified symbol or function from codebase-memory.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
        qualified_name: { type: 'string', description: 'Full qualified name of the symbol (e.g. "app.auth.login").' },
        file_path: { type: 'string', description: 'File path containing the symbol.' },
        start_line: { type: 'number', description: 'Start line (1-based, optional).' },
        end_line: { type: 'number', description: 'End line (optional).' },
      },
    },
    execute: async (args) => {
      const a = withProject(args);
      if (!a.project) throw new Error('Missing project: provide project or repo path');
      return client.call('get_code_snippet', {
        project: a.project,
        qualified_name: a.qualified_name,
        file_path: a.file_path,
        start_line: a.start_line,
        end_line: a.end_line,
      });
    },
  });

  register({
    name: 'cbm_arch',
    description: 'Get an architectural summary of a directory: key components, entry points, and dependencies.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
        directory: { type: 'string', description: 'Subdirectory to analyze (relative to repo root).' },
        depth: { type: 'number', description: 'Analysis depth (default 2).' },
      },
    },
    execute: async (args) => {
      const a = withProject(args);
      if (!a.project) throw new Error('Missing project: provide project or repo path');
      return client.call('get_architecture', {
        project: a.project,
        directory: a.directory,
        depth: a.depth,
      });
    },
  });

  register({
    name: 'cbm_trace',
    description: 'Trace inbound/outbound call paths through the knowledge graph from a specific symbol.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
        symbol: { type: 'string', description: 'Target symbol or function name to trace from.' },
        direction: { type: 'string', enum: ['inbound', 'outbound', 'both'], description: 'Trace direction (default "both").' },
        max_depth: { type: 'number', description: 'Maximum hop depth (default 3).' },
      },
      required: ['symbol'],
    },
    execute: async (args) => {
      const a = withProject(args);
      if (!a.project) throw new Error('Missing project: provide project or repo path');
      return client.call('trace_path', {
        project: a.project,
        function_name: a.symbol,
        direction: a.direction || 'both',
        depth: a.max_depth,
      });
    },
  });

  register({
    name: 'cbm_search_code',
    description: 'Fast textual regex search over indexed repository files in codebase-memory.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
        query: { type: 'string', description: 'Search term or regex pattern.' },
        file_pattern: { type: 'string', description: 'Glob/regex to restrict file paths.' },
        limit: { type: 'number', description: 'Maximum results (default 50).' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const a = withProject(args);
      if (!a.project) throw new Error('Missing project: provide project or repo path');
      return client.call('search_code', {
        project: a.project,
        query: a.query,
        file_pattern: a.file_pattern,
        limit: a.limit,
      });
    },
  });
}

/**
 * Main application hook for cordis context.
 */
export function cbmApply(ctx) {
  const client = getOrCreateClient();
  if (!client) return;

  ctx.effect(() => () => {
    client.dispose();
  });

  // Eagerly start daemon/UI on plugin load unless running inside unit tests
  const isTest =
    process.env.NODE_ENV === 'test' ||
    process.execArgv.includes('--test') ||
    process.argv.includes('--test') ||
    process.argv.some((arg) => typeof arg === 'string' && (arg.endsWith('.test.mjs') || arg.endsWith('.test.js')));

  const exe = findExe();
  if (exe && !isTest) {
    client
      .start()
      .then(() => {
        console.log('\x1b[36m[codebase-memory]\x1b[0m 🔍 \x1b[1mcodebase-memory UI is live:\x1b[0m \x1b[32mhttp://localhost:9749/\x1b[0m');
      })
      .catch((err) => {
        console.warn('[codebase-memory] codebase-memory-mcp failed to start:', err.message);
      });
  }

  if (ctx?.tools && typeof ctx.tools.register === 'function') {
    registerCbmTools(ctx, client);
  }
}
