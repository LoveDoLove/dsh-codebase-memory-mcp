/**
 * Codebase Memory — DSH Tool Definitions.
 *
 * Implements the 6 primary AST/graph intelligence tools:
 *   - cbm_projects: list all indexed projects
 *   - cbm_search: search symbols, functions, classes, interfaces
 *   - cbm_snippet: fetch exact code snippet for a qualified symbol
 *   - cbm_trace: trace call hierarchies (inbound, outbound, both)
 *   - cbm_arch: architectural summary of directory components
 *   - cbm_search_code: fast textual regex search over indexed files
 */

import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { CodeIntelligenceEngine } from './engine.mjs'

const require = createRequire(import.meta.url)
let defineTool = (spec) => spec
try {
  const dshTools = require('@deepseek-ai/dsh-tools')
  if (typeof dshTools.defineTool === 'function') defineTool = dshTools.defineTool
} catch {
  // pass-through
}

export function textBlocks(text) {
  return [{ type: 'text', text: String(text ?? '') }]
}

export function toRawOutputSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  if (Array.isArray(schema.oneOf)) {
    return { ...schema, oneOf: schema.oneOf.map(toRawOutputSchema) }
  }
  if (schema.type === 'array') {
    return schema.items ? { ...schema, items: toRawOutputSchema(schema.items) } : { ...schema }
  }
  if (schema.type !== 'object') {
    if (!Object.hasOwn(schema, 'required')) return schema
    const { required: _drop, ...rest } = schema
    return rest
  }
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : null
  const lifted = []
  const nextProps = {}
  if (properties) {
    for (const [key, node] of Object.entries(properties)) {
      if (node && typeof node === 'object' && !Array.isArray(node) && node.required === true) {
        lifted.push(key)
        const { required: _drop, ...rest } = node
        nextProps[key] = toRawOutputSchema(rest)
      } else {
        nextProps[key] = toRawOutputSchema(node)
      }
    }
  }
  const required = Array.isArray(schema.required)
    ? [...new Set([...schema.required, ...lifted])]
    : lifted
  const next = { ...schema }
  if (properties) next.properties = nextProps
  if (required.length) next.required = required
  else delete next.required
  return next
}

export function resolveWorkspace(source) {
  const candidates = [
    source?.session?.header?.cwd,
    source?.agent?.session?.header?.cwd,
    source?.header?.cwd,
    source?.cwd,
    source?.agent?.cwd,
    source?.session?.cwd,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return resolve(c.trim())
  }
  return process.cwd()
}

/**
 * Build the 6 codebase-memory tool definitions.
 * @param {object} [runtime] Optional runtime containing codeEngine, fallbackCwd, etc.
 * @returns {Array<object>} Array of tool definition objects.
 */
export function createCbmToolDefinitions(runtime = {}) {
  const getEngine = (exec) => {
    if (runtime?.codeEngine) return runtime.codeEngine
    if (runtime?.client) return new CodeIntelligenceEngine({ client: runtime.client })
    if (runtime instanceof CodeIntelligenceEngine) return runtime
    return new CodeIntelligenceEngine(runtime)
  }

  const getCwd = (exec) => {
    return resolveWorkspace(exec?.agent) || runtime?.fallbackCwd || process.cwd()
  }

  return [
    {
      name: 'cbm_projects',
      description: 'List all projects currently indexed in codebase-memory-mcp.',
      parameters: {
        reason: { type: 'string', required: true, description: 'Brief explanation of why you are calling this tool' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            message: { type: 'string' },
            projects: { type: 'array' },
          },
        },
        render: (_args, value) => {
          if (value?.degraded) return textBlocks(`Code Intelligence Degraded: ${value?.message || 'Service unavailable'}`)
          const text = value?.raw?.trim()
          if (!text || text === 'No projects indexed.') return textBlocks('No projects indexed.')
          return textBlocks(text)
        },
      },
      async execute(args, exec) {
        const engine = getEngine(exec)
        return await engine.listProjects()
      },
      presentCall: (args) => ({ card: 'generic', title: 'Code Projects', kind: 'read', rawInput: args?.reason }),
    },
    {
      name: 'cbm_search',
      description: 'Search the code knowledge graph for symbols, functions, classes, or files. Filter by name_pattern, label (Function, Class, Interface, File), or degree.',
      parameters: {
        name_pattern: { type: 'string', description: 'Regex/substring to filter node names (e.g. ".*auth.*").' },
        label: { type: 'string', description: 'Node label filter: Function | Class | Interface | File' },
        file_path_pattern: { type: 'string', description: 'Regex to filter by file path.' },
        project: { type: 'string', description: 'Project name (e.g. C-repos-myproject). Defaults to current repo.' },
        repo: { type: 'string', description: 'Repository root path as fallback if project name not known.' },
        limit: { type: 'number', description: 'Maximum results to return (default 50).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            message: { type: 'string' },
            raw: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value?.degraded) return textBlocks(`Code Intelligence Degraded: ${value?.message || 'Service unavailable'}`)
          return textBlocks(value?.raw || (value?.ok ? 'No matching symbols found.' : value?.message || 'Search failed.'))
        },
      },
      async execute(args, exec) {
        const cwd = getCwd(exec)
        const targetRepo = args?.repo || cwd
        const engine = getEngine(exec)
        return await engine.searchSymbols(targetRepo, args)
      },
      presentCall: (args) => ({ card: 'generic', title: 'Code Search', kind: 'read', rawInput: args?.name_pattern || args?.file_path_pattern || 'all' }),
    },
    {
      name: 'cbm_snippet',
      description: 'Fetch the exact source code snippet for a qualified symbol or function from codebase-memory.',
      parameters: {
        qualified_name: { type: 'string', required: true, description: 'Full qualified name of the symbol (e.g. "app.auth.login").' },
        file_path: { type: 'string', description: 'File path containing the symbol.' },
        start_line: { type: 'number', description: 'Start line (1-based, optional).' },
        end_line: { type: 'number', description: 'End line (optional).' },
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            message: { type: 'string' },
            snippet: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value?.degraded) return textBlocks(`Code Intelligence Degraded: ${value?.message || 'Service unavailable'}`)
          return textBlocks(value?.snippet || value?.message || 'No snippet available.')
        },
      },
      async execute(args, exec) {
        const cwd = getCwd(exec)
        const targetRepo = args?.repo || cwd
        const engine = getEngine(exec)
        return await engine.getCodeSnippet(targetRepo, args)
      },
      presentCall: (args) => ({ card: 'generic', title: 'Code Snippet', kind: 'read', rawInput: args?.qualified_name }),
    },
    {
      name: 'cbm_trace',
      description: 'Trace inbound/outbound call paths through the knowledge graph from a specific symbol.',
      parameters: {
        symbol: { type: 'string', required: true, description: 'Target symbol or function name to trace from.' },
        direction: { type: 'string', description: 'Trace direction (default "both"): inbound | outbound | both' },
        max_depth: { type: 'number', description: 'Maximum hop depth (default 3).' },
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            message: { type: 'string' },
            raw: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value?.degraded) return textBlocks(`Code Intelligence Degraded: ${value?.message || 'Service unavailable'}`)
          return textBlocks(value?.raw || (value?.ok ? 'No call paths found.' : value?.message || 'Trace failed.'))
        },
      },
      async execute(args, exec) {
        const cwd = getCwd(exec)
        const targetRepo = args?.repo || cwd
        const engine = getEngine(exec)
        return await engine.traceCallPath(targetRepo, args)
      },
      presentCall: (args) => ({ card: 'generic', title: 'Code Call Trace', kind: 'read', rawInput: `${args?.symbol} (${args?.direction || 'both'})` }),
    },
    {
      name: 'cbm_arch',
      description: 'Get an architectural summary of a directory: key components, entry points, and dependencies.',
      parameters: {
        directory: { type: 'string', description: 'Subdirectory to analyze (relative to repo root).' },
        depth: { type: 'number', description: 'Analysis depth (default 2).' },
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            message: { type: 'string' },
            raw: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value?.degraded) return textBlocks(`Code Intelligence Degraded: ${value?.message || 'Service unavailable'}`)
          return textBlocks(value?.overview || value?.raw || (value?.ok ? 'No architectural summary available.' : value?.message || 'Arch query failed.'))
        },
      },
      async execute(args, exec) {
        const cwd = getCwd(exec)
        const targetRepo = args?.repo || cwd
        const engine = getEngine(exec)
        return await engine.getArchitecture(targetRepo, args)
      },
      presentCall: (args) => ({ card: 'generic', title: 'Architecture Summary', kind: 'read', rawInput: args?.directory || '' }),
    },
    {
      name: 'cbm_search_code',
      description: 'Fast textual regex search over indexed repository files in codebase-memory.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search term or regex pattern.' },
        file_pattern: { type: 'string', description: 'Glob/regex to restrict file paths.' },
        limit: { type: 'number', description: 'Maximum results (default 50).' },
        project: { type: 'string', description: 'Project name.' },
        repo: { type: 'string', description: 'Repository root path.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean' },
            degraded: { type: 'boolean' },
            message: { type: 'string' },
            results: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value?.degraded) return textBlocks(`Code Intelligence Degraded: ${value?.message || 'Service unavailable'}`)
          return textBlocks(value?.results || (value?.ok ? 'No matches found.' : value?.message || 'Search failed.'))
        },
      },
      async execute(args, exec) {
        const cwd = getCwd(exec)
        const targetRepo = args?.repo || cwd
        const engine = getEngine(exec)
        return await engine.searchCodeText(targetRepo, args)
      },
      presentCall: (args) => ({ card: 'generic', title: 'Search Code Text', kind: 'read', rawInput: args?.query }),
    },
  ]
}

/**
 * Register CBM tools with Cordis context.tools service.
 * Avoids duplicate registration if tools are already registered.
 */
export function registerCbmTools(ctx, clientOrOpts = {}) {
  if (!ctx?.tools?.register) return []

  let runtime = {}
  let legacyText = false

  if (clientOrOpts && typeof clientOrOpts.call === 'function') {
    runtime = {
      codeEngine: new CodeIntelligenceEngine({ client: clientOrOpts }),
    }
    legacyText = Boolean(clientOrOpts._legacyText)
  } else if (clientOrOpts && (clientOrOpts.codeEngine || clientOrOpts.client)) {
    runtime = {
      codeEngine: clientOrOpts.codeEngine || new CodeIntelligenceEngine({ client: clientOrOpts.client }),
      ...clientOrOpts,
    }
    legacyText = Boolean(clientOrOpts.legacyText)
  } else {
    runtime = clientOrOpts || {}
  }

  const toolDefs = createCbmToolDefinitions(runtime)
  const registered = []

  for (const def of toolDefs) {
    let toolToRegister = def
    if (legacyText) {
      toolToRegister = {
        ...def,
        execute: async (args, exec) => {
          const res = await def.execute(args, exec)
          if (typeof res === 'string') return res
          if (res?.raw !== undefined) return res.raw
          if (res?.snippet !== undefined) return res.snippet
          if (res?.message !== undefined) return res.message
          return JSON.stringify(res)
        },
      }
    }

    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => {
          ctx.tools.register(defineTool(toolToRegister))
        }, `codebase-memory: tool ${def.name}`)
      } else {
        ctx.tools.register(defineTool(toolToRegister))
      }
      registered.push(def.name)
    } catch (err) {
      // If already registered or cannot register, skip
    }
  }

  return registered
}
