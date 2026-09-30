import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  cbmApply,
  getOrCreateClient,
  findExe,
  projectNameFromPath,
  autoStartCodebaseMemory,
  createClient,
  registerCbmTools,
} from './bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_FILE = join(__dirname, '../skills/codebase-memory/SKILL.md');

function registerBundledSkills(ctx) {
  if (!ctx?.skills || typeof ctx.skills.registerProvider !== 'function') return;
  if (!existsSync(SKILL_FILE)) return;

  try {
    const raw = readFileSync(SKILL_FILE, 'utf8');
    const content = raw.replace(/^---\s*\n[\s\S]*?\n---\s*/m, '').trim();
    const candidate = {
      name: 'codebase-memory',
      description:
        'Use the codebase knowledge graph for structural code queries. Triggers on: explore the codebase, understand the architecture, what functions exist, show me the structure, who calls this function, what does X call, trace the call chain, find callers of, show dependencies, impact analysis, dead code, unused functions, high fan-out, refactor candidates, code quality audit, graph query syntax, Cypher query examples, edge types, how to use search_graph.',
      invocation: 'user-or-agent',
      provider: 'codebase-memory-bundled',
      source: 'bundled',
      locator: pathToFileURL(SKILL_FILE),
    };

    const provider = {
      name: 'codebase-memory-bundled',
      list: async () => [candidate],
      get: async () => ({
        ...candidate,
        content,
      }),
    };

    ctx.skills.registerProvider(() => provider);
  } catch (err) {
    console.warn('[codebase-memory] Failed to register bundled skill:', err.message);
  }
}

function registerSlashCommands(ctx) {
  if (!ctx?.commands || typeof ctx.commands.register !== 'function') return;
  try {
    ctx.effect(() => {
      ctx.commands.register({
        name: 'cbm',
        description: 'Show codebase-memory status and Web UI link (http://localhost:9749/)',
        execute: async () => {
          const exe = findExe();
          if (!exe) {
            return '⚠️ codebase-memory-mcp executable not found. Please install codebase-memory-mcp or set CBM_EXE.';
          }
          const client = getOrCreateClient();
          let projectList = '';
          try {
            if (client) {
              projectList = await client.call('list_projects', {});
            }
          } catch (e) {
            projectList = `Error querying projects: ${e.message}`;
          }
          return [
            '🔍 **Codebase Memory MCP**',
            `• Executable: \`${exe}\``,
            '• Web UI: http://localhost:9749/',
            '',
            '**Indexed Projects:**',
            '```',
            projectList.trim() || 'No projects indexed yet.',
            '```',
          ].join('\n');
        },
      });
    }, 'codebase-memory: slash-commands');
  } catch {
    // Ignore if commands service is unavailable
  }
}

/**
 * Cordis plugin apply hook.
 * @param {object} ctx Cordis context
 * @param {object} [config] Plugin options
 */
export function apply(ctx, config = {}) {
  const exe = findExe();
  if (!exe) {
    console.warn(
      '\x1b[33m[codebase-memory]\x1b[0m ⚠️ codebase-memory-mcp not installed (optional for advanced code search)'
    );
    return;
  }

  // 1. Tool registration & auto-start
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['tools'], (targetCtx) => cbmApply(targetCtx));
    } catch {
      cbmApply(ctx);
    }
  } else {
    cbmApply(ctx);
  }

  // 2. Bundled skill registration
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['skills'], (targetCtx) => registerBundledSkills(targetCtx));
    } catch {
      registerBundledSkills(ctx);
    }
  } else {
    registerBundledSkills(ctx);
  }

  // 3. Slash command registration
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['commands'], (targetCtx) => registerSlashCommands(targetCtx));
    } catch {
      registerSlashCommands(ctx);
    }
  } else {
    registerSlashCommands(ctx);
  }
}

export default {
  apply,
};

export {
  cbmApply,
  getOrCreateClient,
  findExe,
  projectNameFromPath,
  autoStartCodebaseMemory,
  createClient,
  registerCbmTools,
};
