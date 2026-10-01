import {
  cbmApply,
  getOrCreateClient,
  findExe,
  projectNameFromPath,
  autoStartCodebaseMemory,
  createClient,
  registerCbmTools,
} from './bridge.mjs';
import { registerSkills } from './skills.mjs';

export const name = 'codebase-memory';
export const inject = ['tools'];

export const GUIDANCE_TEXT = `## Codebase Memory — Knowledge Graph Policy
Codebase Memory provides structural code intelligence and AST-level call-graph navigation.
Tools: \`cbm_projects\`, \`cbm_search\`, \`cbm_snippet\`, \`cbm_trace\`, \`cbm_arch\`, \`cbm_search_code\`.
Web visual graph interface: http://localhost:9749/

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
4. Inspect definition: \`cbm_snippet(qualified_name="...")\` to inspect code without loading entire files.`;

function loggerOf(ctx) {
  const log = ctx.logger ? ctx.logger('codebase-memory') : console;
  return {
    info: (...args) => { try { log.info(...args); } catch { /* ignore */ } },
    warn: (...args) => { try { log.warn(...args); } catch { /* ignore */ } },
    debug: (...args) => { try { log.debug?.(...args); } catch { /* ignore */ } },
  };
}

export function registerSystemPromptGuidance(scope, log) {
  if (!scope?.systemPrompt || typeof scope.systemPrompt.section !== 'function') return false;
  try {
    scope.effect(
      () => scope.systemPrompt.section({
        name: 'codebase-memory:guidance',
        order: 3040,
        text: GUIDANCE_TEXT,
      }),
      'codebase-memory: guidance',
    );
    log?.info('[codebase-memory] registered system prompt guidance');
    return true;
  } catch (err) {
    log?.warn(`[codebase-memory] systemPrompt.section failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function registerSlashCommands(scope, log) {
  if (!scope?.commands || typeof scope.commands.register !== 'function') return false;
  try {
    scope.effect(() => scope.commands.register({
      name: 'cbm',
      description: 'Show codebase-memory status and Web UI link (http://localhost:9749/)',
      handler: async () => {
        const exe = findExe();
        if (!exe) {
          return {
            kind: 'success',
            text: '⚠️  codebase-memory-mcp executable not found. Install codebase-memory-mcp or set CBM_EXE.',
          };
        }
        const client = getOrCreateClient();
        let projectList = '';
        try {
          if (client) projectList = await client.call('list_projects', {});
        } catch (e) {
          projectList = `Error querying projects: ${e.message}`;
        }
        return {
          kind: 'success',
          text: [
            '🔍 **Codebase Memory MCP**',
            `• Executable: \`${exe}\``,
            '• Web UI: http://localhost:9749/',
            '',
            '**Indexed Projects:**',
            '```',
            projectList.trim() || 'No projects indexed yet.',
            '```',
          ].join('\n'),
        };
      },
    }), 'codebase-memory: slash-commands');
    return true;
  } catch {
    return false;
  }
}

/**
 * Cordis plugin apply hook.
 * @param {object} ctx Cordis context
 * @param {object} [config] Plugin options
 */
export function apply(ctx, config = {}) {
  const log = loggerOf(ctx);

  // 1. Tool registration & auto-start (ctx.tools is guaranteed by inject=['tools'])
  const toolNames = cbmApply(ctx);
  if (Array.isArray(toolNames) && toolNames.length) {
    log.info(`[codebase-memory] registered tools: ${toolNames.join(', ')}`);
  }

  // 2. System prompt — must use ctx.inject(), never direct property access
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['systemPrompt'], (scope) => {
        registerSystemPromptGuidance(scope, log);
      });
    } catch {
      // systemPrompt service not available; skip
    }
  }

  // 3. Bundled skill registration — must use ctx.inject()
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['skills'], (scope) => {
        void registerSkills(scope, log).then((names) => {
          if (names.length) log.info(`[codebase-memory] registered skill: ${names.join(', ')}`);
        }).catch((err) => {
          log.warn(`[codebase-memory] skill register failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      });
    } catch {
      // skills service not available; skip
    }
  }

  // 4. Slash command registration — must use ctx.inject()
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['commands'], (scope) => {
        if (registerSlashCommands(scope, log)) {
          log.info('[codebase-memory] registered /cbm command');
        }
      });
    } catch {
      // commands service not available; skip
    }
  }
}

export default { name, inject, apply };

export {
  cbmApply,
  getOrCreateClient,
  findExe,
  projectNameFromPath,
  autoStartCodebaseMemory,
  createClient,
  registerCbmTools,
};
