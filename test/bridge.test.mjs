import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  projectNameFromPath,
  createClient,
  findExe,
  registerCbmTools,
} from '../src/bridge.mjs';
import { apply } from '../src/index.mjs';

// --- projectNameFromPath ---

test('Windows drive-lettered paths keep the drive-letter prefix (existing behavior)', () => {
  assert.equal(projectNameFromPath('C:/Users/user/agent-core'), 'C-Users-user-agent-core');
  assert.equal(projectNameFromPath('C:\\Users\\user\\agent-core'), 'C-Users-user-agent-core');
  assert.equal(projectNameFromPath('d:/repos/my-app'), 'C-repos-my-app');
});

test('Linux/WSL paths slug without a drive prefix', () => {
  assert.equal(projectNameFromPath('/home/user/agent-core'), 'home-user-agent-core');
  assert.equal(projectNameFromPath('/mnt/d/Projects/Project-Memory-Agent'), 'mnt-d-Projects-Project-Memory-Agent');
  assert.equal(projectNameFromPath('/home/user/.qclaw/proj'), 'home-user-.qclaw-proj');
});

// --- findExe ---

test('findExe respects CBM_EXE environment variable', () => {
  const orig = process.env.CBM_EXE;
  const dir = mkdtempSync(join(tmpdir(), 'cbm-find-'));
  const dummy = join(dir, 'custom-cbm');
  try {
    writeFileSync(dummy, '#!/bin/sh\n');
    process.env.CBM_EXE = dummy;
    assert.equal(findExe(), dummy);
  } finally {
    if (orig !== undefined) process.env.CBM_EXE = orig;
    else delete process.env.CBM_EXE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findExe discovers binary or returns null if not installed', () => {
  const found = findExe();
  if (found) {
    assert.ok(existsSync(found), `Found path ${found} must exist`);
  }
});

// --- createClient with mock stdio MCP server ---

function fakeMcpServer() {
  return [
    '#!/usr/bin/env node',
    "let buf = '';",
    "process.stdin.on('data', d => {",
    '  buf += d;',
    '  let i;',
    '  while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {',
    '    const line = buf.slice(0, i).trim();',
    '    buf = buf.slice(i + 1);',
    '    if (!line) continue;',
    '    const msg = JSON.parse(line);',
    "    if (msg.method === 'initialize') {",
    "      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake-cbm' } } }));",
    "    } else if (msg.method === 'tools/call') {",
    "      if (msg.params.name === 'error_tool') {",
    "        console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'Boom error' }] } }));",
    '      } else {',
    "        console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'OK:' + msg.params.name + ':' + JSON.stringify(msg.params.arguments) }] } }));",
    '      }',
    '    }',
    '  }',
    '});',
    '',
  ].join('\n');
}

test('createClient spawns executable and handles MCP tool calls and errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-test-'));
  const exe = join(dir, 'fake-cbm-mcp');
  writeFileSync(exe, fakeMcpServer());
  execSync(`chmod +x "${exe}"`);

  const client = createClient(exe);
  try {
    const text = await client.call('search_graph', { query: 'test-sym' });
    assert.match(text, /^OK:search_graph:/);
    assert.ok(text.includes('test-sym'));

    await assert.rejects(
      async () => {
        await client.call('error_tool', {});
      },
      /Boom error/
    );
  } finally {
    client.dispose();
    assert.equal(client.isRunning(), false);
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 30_000 });

// --- registerCbmTools ---

test('registerCbmTools registers all 6 cbm_* tools and handles execution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbm-reg-'));
  const exe = join(dir, 'fake-cbm-mcp');
  writeFileSync(exe, fakeMcpServer());
  execSync(`chmod +x "${exe}"`);

  const client = createClient(exe);
  const registeredTools = new Map();
  const mockCtx = {
    tools: {
      register: (tool) => {
        registeredTools.set(tool.name, tool);
      },
    },
    effect: (fn) => fn(),
  };

  try {
    await registerCbmTools(mockCtx, client);

    const expectedTools = [
      'cbm_projects',
      'cbm_search',
      'cbm_snippet',
      'cbm_arch',
      'cbm_trace',
      'cbm_search_code',
    ];

    for (const name of expectedTools) {
      assert.ok(registeredTools.has(name), `Tool ${name} should be registered`);
    }

    // Test calling cbm_projects
    const projTool = registeredTools.get('cbm_projects');
    const projRes = await projTool.execute({});
    assert.match(projRes, /OK:list_projects/);

    // Test calling cbm_search with repo path resolving to project
    const searchTool = registeredTools.get('cbm_search');
    const searchRes = await searchTool.execute({ repo: '/home/user/myproject', name_pattern: 'foo' });
    assert.match(searchRes, /home-user-myproject/);

    // Test calling cbm_trace
    const traceTool = registeredTools.get('cbm_trace');
    const traceRes = await traceTool.execute({ project: 'test-p', symbol: 'myFunc' });
    assert.match(traceRes, /OK:trace_path/);
  } finally {
    client.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Plugin apply hook ---

test('plugin apply registers tools, skills, commands and systemPrompt on Cordis context', async () => {
  let skillProviderRegistered = false;
  let commandRegistered = false;
  let systemPromptRegistered = false;
  const registeredTools = [];

  const mockCtx = {
    tools: {
      register: (tool) => registeredTools.push(tool.name),
    },
    systemPrompt: {
      section: (sec) => {
        systemPromptRegistered = true;
        assert.equal(sec.name, 'codebase-memory:guidance');
        assert.equal(sec.order, 3040);
        assert.match(sec.text, /Codebase Memory/);
      },
    },
    skills: {
      registerProvider: (fn) => {
        skillProviderRegistered = true;
        const provider = fn();
        assert.equal(provider.name, 'codebase-memory-bundled');
      },
    },
    commands: {
      register: (cmd) => {
        commandRegistered = true;
        assert.equal(cmd.name, 'cbm');
      },
    },
    effect: (fn) => fn(),
    inject: (deps, fn) => fn(mockCtx),
  };

  apply(mockCtx);

  if (findExe()) {
    assert.ok(registeredTools.length >= 6, 'Tools should be registered');
    assert.ok(skillProviderRegistered, 'Skill provider should be registered');
    assert.ok(commandRegistered, 'Command /cbm should be registered');
    assert.ok(systemPromptRegistered, 'System prompt section should be registered');
  }
});

// --- Real binary integration test (when installed) ---

test('real binary responds to list_projects when installed on host', async (t) => {
  const exe = findExe();
  if (!exe) {
    t.skip('codebase-memory-mcp binary not found on host');
    return;
  }

  const client = createClient(exe);
  try {
    const res = await client.call('list_projects', {});
    assert.ok(typeof res === 'string', 'Result should be string');
    assert.ok(res.length > 0, 'Result should not be empty');
  } finally {
    client.dispose();
  }
}, { timeout: 30_000 });
