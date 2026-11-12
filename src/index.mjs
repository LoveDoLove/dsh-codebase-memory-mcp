/**
 * Codebase Memory (CBM) MCP Plugin & Library.
 *
 * Provides AST-level structural code intelligence, call hierarchies,
 * symbol indexing, textual search, and knowledge graph navigation.
 */

import Schema from '@deepseek-ai/schemastery'
import {
  projectNameFromPath,
} from './bridge.mjs'
import { cbmApply, findExe, getOrCreateClient } from './client.mjs'
import { registerCbmTools } from './tools.mjs'
import { registerSkills } from './skills.mjs'
import { DEFAULT_UI_PORT } from './types.mjs'

// --- Core Re-exports ---
export * from './types.mjs'
export * from './redact.mjs'
export * from './discovery.mjs'
export * from './client.mjs'
export * from './engine.mjs'
export * from './watcher.mjs'
export * from './tools.mjs'

// --- Legacy Bridge Re-exports ---
export {
  projectNameFromPath,
}

export const name = 'codebase-memory'
export const inject = ['tools']

/**
 * Plugin configuration, settable from cordis.yml.
 * @typedef {object} Config
 * @property {string} [exePath] Path to the codebase-memory-mcp binary; falls back to CBM_EXE, then PATH discovery.
 * @property {boolean} [uiEnabled] Pass --ui to the daemon and advertise the graph UI.
 * @property {number} [port] Preferred daemon UI port.
 * @property {boolean} [eagerStart] Start the daemon as soon as the plugin loads.
 */

export const Config = Schema.object({
  exePath: Schema.string().description('Path to the codebase-memory-mcp binary; falls back to CBM_EXE, then PATH discovery.'),
  uiEnabled: Schema.boolean().default(true).description('Pass --ui to the daemon and advertise the graph UI.'),
  port: Schema.number().default(DEFAULT_UI_PORT).description('Preferred daemon UI port.'),
  eagerStart: Schema.boolean().default(true).description('Start the daemon as soon as the plugin loads.'),
})

export const guidanceText = (port = DEFAULT_UI_PORT) => `## Codebase Memory — Knowledge Graph Policy
Codebase Memory provides structural code intelligence and AST-level call-graph navigation.
Tools: \`cbm_projects\`, \`cbm_search\`, \`cbm_snippet\`, \`cbm_trace\`, \`cbm_arch\`, \`cbm_search_code\`.
Web visual graph interface: http://localhost:${port}/

When to use Codebase Memory vs text grep:
- Prefer \`cbm_trace\` for caller/callee relationships, call hierarchies, and blast-radius / impact analysis (precise structural graph vs noisy text search).
- Prefer \`cbm_search\` to discover functions, classes, interfaces, or files by name pattern or AST label.
- Prefer \`cbm_snippet\` to retrieve exact symbol definitions and their immediate context with minimal token overhead.
- Prefer \`cbm_arch\` for directory-level component dependency overview.
- Use \`grep\`/\`read\` when editing files, reading non-code assets, or searching exact string literals.

Workflow:
1. Identify the indexed project: call \`cbm_projects()\`. By default tools infer project from workspace.
2. Search symbols: \`cbm_search(name_pattern="...")\` to find exact symbol names.
3. Trace dependencies: \`cbm_trace(symbol="...", direction="inbound"|"outbound"|"both")\` to trace call graphs.
4. Inspect definition: \`cbm_snippet(qualified_name="...")\` to inspect code without loading entire files.`

export const GUIDANCE_TEXT = guidanceText()

function loggerOf(ctx) {
  const log = ctx.logger ? ctx.logger('codebase-memory') : console
  return {
    info: (...args) => { try { log.info(...args) } catch { /* ignore */ } },
    warn: (...args) => { try { log.warn(...args) } catch { /* ignore */ } },
    debug: (...args) => { try { log.debug?.(...args) } catch { /* ignore */ } },
  }
}

export function registerSystemPromptGuidance(scope, log, port = DEFAULT_UI_PORT) {
  if (!scope?.systemPrompt || typeof scope.systemPrompt.section !== 'function') return false
  try {
    scope.effect(
      () => scope.systemPrompt.section({
        name: 'codebase-memory:guidance',
        order: 3040,
        text: guidanceText(port),
      }),
      'codebase-memory: guidance',
    )
    log?.info?.('[codebase-memory] registered system prompt guidance')
    return true
  } catch (err) {
    log?.warn?.(`[codebase-memory] systemPrompt.section failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

export function registerSlashCommands(scope, log, port = DEFAULT_UI_PORT) {
  if (!scope?.commands || typeof scope.commands.register !== 'function') return false
  try {
    scope.effect(() => scope.commands.register({
      name: 'cbm',
      description: `Show codebase-memory status and Web UI link (http://localhost:${port}/)`,
      handler: async () => {
        const exe = findExe()
        if (!exe) {
          return {
            kind: 'success',
            text: '⚠️  codebase-memory-mcp executable not found. Install codebase-memory-mcp or set CBM_EXE.',
          }
        }
        const client = getOrCreateClient()
        let projectList = ''
        try {
          if (client) {
            const res = await client.listProjects?.() || await client.call?.('list_projects', {})
            if (typeof res === 'string') {
              projectList = res
            } else if (res?.raw) {
              projectList = res.raw
            } else if (res?.projects) {
              projectList = res.projects.join('\n')
            } else if (Array.isArray(res?.content)) {
              projectList = res.content.map((c) => c.text || '').join('\n')
            }
          }
        } catch (e) {
          projectList = `Error querying projects: ${e.message}`
        }
        return {
          kind: 'success',
          text: [
            '🔍 **Codebase Memory MCP**',
            `• Executable: \`${exe}\``,
            `• Web UI: http://localhost:${port}/`,
            '',
            '**Indexed Projects:**',
            '```',
            projectList.trim() || 'No projects indexed yet.',
            '```',
          ].join('\n'),
        }
      },
    }), 'codebase-memory: slash-commands')
    return true
  } catch (err) {
    log?.warn?.(`[codebase-memory] commands.register failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/**
 * Cordis plugin apply hook.
 * @param {object} ctx Cordis context
 * @param {object} [config] Plugin options
 */
export function apply(ctx, config = {}) {
  const log = loggerOf(ctx)
  const port = config.port || DEFAULT_UI_PORT

  // 1. Client lifecycle, eager daemon start, and tool registration.
  //    cbmApply owns the dispose effect and the auto-start; the 0.1.5 rewrite
  //    called getOrCreateCodeClient() directly and lost the start().
  const client = cbmApply(ctx, config)
  const toolNames = registerCbmTools(ctx, client)
  if (Array.isArray(toolNames) && toolNames.length) {
    log.info(`[codebase-memory] registered tools: ${toolNames.join(', ')}`)
  }

  // 2-4. Optional capabilities. ctx.inject() waits for the service, so a
  //      missing service is not an error — but a real registration failure
  //      must surface instead of disappearing.
  injectCapability(ctx, log, 'systemPrompt', ['systemPrompt'], (scope) => {
    registerSystemPromptGuidance(scope, log, port)
  })
  injectCapability(ctx, log, 'skills', ['skills'], (scope) => {
    void registerSkills(scope, log).then((names) => {
      if (names.length) log.info(`[codebase-memory] registered skill: ${names.join(', ')}`)
    }).catch((err) => {
      log.warn(`[codebase-memory] skill register failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  })
  injectCapability(ctx, log, 'commands', ['commands'], (scope) => {
    if (registerSlashCommands(scope, log, port)) {
      log.info('[codebase-memory] registered /cbm command')
    }
  })
}

function injectCapability(ctx, log, label, deps, callback) {
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(deps, callback)
  } catch (err) {
    log.warn(`[codebase-memory] ${label} registration failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export default { name, inject, Config, apply }
