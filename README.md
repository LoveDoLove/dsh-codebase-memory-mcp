# @lovedolove/dsh-codebase-memory-mcp

> Standalone **Codebase Memory MCP bridge plugin** for DeepSeek Harness (DSH).
> Registers six knowledge-graph code tools, auto-starts the `codebase-memory-mcp`
> daemon with its graph-visualization Web UI, and ships a bundled agent skill plus
> a `/cbm` status command.

[![npm version](https://img.shields.io/npm/v/@lovedolove/dsh-codebase-memory-mcp.svg)](https://www.npmjs.com/package/@lovedolove/dsh-codebase-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/LoveDoLove/dsh-codebase-memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/LoveDoLove/dsh-codebase-memory-mcp/actions/workflows/ci.yml)

---

## Features

- **Six knowledge-graph code tools** registered natively on the DSH tool surface
  (`cbm_projects`, `cbm_search`, `cbm_snippet`, `cbm_arch`, `cbm_trace`,
  `cbm_search_code`). The bundled skill's guidance notes that graph queries return
  precise structural results in ~500 tokens vs ~80K for grep.
- **Auto-started background daemon & Web UI** — spawns
  `codebase-memory-mcp --ui=true` as a child process over stdio JSON-RPC 2.0
  (MCP handshake `2025-03-26`) when the plugin loads, and prints
  `codebase-memory UI is live: http://localhost:9749/`. The shared client
  restarts the daemon automatically if it exits and disposes it when the plugin
  shuts down.
- **System-prompt guidance** — injects a *Codebase Memory — Knowledge Graph
  Policy* section that tells the model when to prefer the graph tools over
  `grep`/`read`.
- **Bundled agent skill** — [`skills/codebase-memory/SKILL.md`](skills/codebase-memory/SKILL.md)
  is registered as a native bundled skill provider (`codebase-memory`, rank 600,
  model- and user-invocable), so the model-facing `skill` tool can load it.
- **`/cbm` slash command** — reports the resolved executable path, the Web UI
  link, and the projects currently indexed in the daemon.
- **Graceful degradation** — only `tools` is a hard dependency (`inject: ['tools']`);
  `systemPrompt`, `skills`, and `commands` are attached via deferred `ctx.inject()`,
  so a missing host service simply skips that feature.
- **Cross-platform executable detection** — `CBM_EXE` override, user and system
  directories, current working directory, `PATH`, and a WSL interop fallback that
  locates `codebase-memory-mcp.exe` reachable from Linux/WSL.

---

## Requirements

| Component | Version |
|-----------|---------|
| DeepSeek Harness | `>=0.1.2-rc.1 <0.3.0-0` (`dsh.compatibility.dshVersions`) |
| Node.js | `>=18 <25` (`engines`) |
| `codebase-memory-mcp` executable | any recent release (tested with `0.11.0`) |

Optional peer dependencies (declared in `peerDependencies`, resolved from the DSH
runtime when present): `@deepseek-ai/cordis` `>=4.0.1-rc.1 <5.0.0-0`, and
`@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-skill`,
`@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools` `>=0.1.2-rc.1 <0.3.0-0`.

> **Install the executable before booting DSH.** The plugin resolves the binary
> when it loads; if none is found, the daemon is not started and the `cbm_*`
> tools are not registered. Installing the binary later requires reloading the
> profile.

---

## Installation

### 1. Install the `codebase-memory-mcp` executable

The plugin is only a bridge — code indexing and querying are done by the
`codebase-memory-mcp` runtime ([upstream project](https://github.com/DeusData/codebase-memory-mcp),
[documentation](https://deusdata.github.io/codebase-memory-mcp/)):

```bash
# Installs the CLI and downloads/caches the native runtime for your platform
npm install -g codebase-memory-mcp

# Verify it runs
codebase-memory-mcp --version
```

Alternatively, download your platform's release binary and place it in one of
the locations the plugin searches:

- `~/.local/bin/codebase-memory-mcp` (Linux/macOS user bin)
- `/usr/local/bin/` or `/usr/bin/` (system directories)
- the current working directory, or anywhere on `PATH`
- `%USERPROFILE%\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe` (Windows)

Or point the plugin at it explicitly with `CBM_EXE=/path/to/codebase-memory-mcp`.

### 2. Install the plugin into a DSH profile

```bash
dsh plugin --profile web add @lovedolove/dsh-codebase-memory-mcp
```

(replace `web` with your profile name — `web`, `headless`, `sdk`, `acp`, …)

This forwards the package install into the profile directory. Because the
package declares `dsh.bundle.patch`, DSH automatically **activates the bundle**
by appending `@lovedolove/dsh-codebase-memory-mcp` to the profile's
`dsh.profile.bundles` list.

Other ways to install:

- **Web sidebar → Plugins page**: search for the package and install it there
  (the `plugin_manager` tool exposes the same operations in Creator mode).
- **Manual wiring**: add the package to the profile's `dependencies` in
  `$DSH_HOME/profiles/<name>/package.json` **and** list it under
  `dsh.profile.bundles`, then run a package install in that directory. The
  shipped bundle patch ([`cordis.patch.yml`](cordis.patch.yml), declared as
  `dsh.bundle.patch`) then mounts the plugin:

  ```yaml
  - insert:
      - id: codebase-memory
        name: '@lovedolove/dsh-codebase-memory-mcp'
  ```

### 3. Start DSH

On plugin load you will see:

```text
[codebase-memory] 🔍 codebase-memory UI is live: http://localhost:9749/
```

and, in the log:

```text
[codebase-memory] registered tools: cbm_projects, cbm_search, cbm_snippet, cbm_arch, cbm_trace, cbm_search_code
[codebase-memory] registered system prompt guidance
[codebase-memory] registered /cbm command
[codebase-memory] registered skill: codebase-memory
```

---

## Usage

### Let the agent use it

The plugin injects the knowledge-graph policy into the system prompt and bundles
the `codebase-memory` skill, so the agent picks the right tool on its own.
Typical workflow:

1. `cbm_projects()` — confirm the project is indexed (by default the project is
   inferred from the workspace).
2. `cbm_search(name_pattern=".*auth.*")` — find symbols by name/label/path.
3. `cbm_trace(symbol="login", direction="both", max_depth=3)` — trace callers
   and callees.
4. `cbm_snippet(qualified_name="app.auth.login")` — read the exact definition
   without loading whole files.
5. `cbm_arch(directory="src")` — get a directory-level component overview.

Quick decision matrix (from the bundled skill):

| Question | Tool call |
|----------|-----------|
| Who calls X? | `cbm_trace(symbol="...", direction="inbound")` |
| What does X call? | `cbm_trace(symbol="...", direction="outbound")` |
| Full call context | `cbm_trace(symbol="...", direction="both")` |
| Find by name pattern | `cbm_search(name_pattern="...")` |
| Read source snippet | `cbm_snippet(qualified_name="...")` |
| Directory architecture | `cbm_arch(directory="...")` |
| Text search in repo | `cbm_search_code(query="...")` |
| List indexed projects | `cbm_projects()` |

### Check status with `/cbm`

````text
🔍 **Codebase Memory MCP**
• Executable: `/home/you/.local/bin/codebase-memory-mcp`
• Web UI: http://localhost:9749/

**Indexed Projects:**
```
home-you-my-repo
```
````

If the binary is missing, `/cbm` reports:
`⚠️  codebase-memory-mcp executable not found. Install codebase-memory-mcp or set CBM_EXE.`

### Web UI

The daemon is launched with `--ui=true`, so an HTTP graph-visualization UI is
served at **http://localhost:9749/** (the runtime's default port; the upstream
binary accepts `--port=N` and persists it — the plugin's prompts and `/cbm`
assume the default 9749).

---

## Available Tools

All six tools accept `project` (explicit project slug) and/or `repo`
(repository root path, slugified automatically) and are marked concurrency-safe.
Results are returned as text.

| Tool | Description | Arguments (★ = required) |
|------|-------------|--------------------------|
| `cbm_projects` | List all projects indexed in the daemon | *(none)* |
| `cbm_search` | Search the knowledge graph for symbols or files | `name_pattern`, `label` (`Function` \| `Class` \| `Interface` \| `File`), `file_path_pattern`, `limit` (default 50), `project`, `repo` |
| `cbm_snippet` | Fetch the exact source snippet of a symbol | `qualified_name`, `file_path`, `start_line`, `end_line`, `project`, `repo` |
| `cbm_arch` | Architectural summary of a directory (components, entry points, dependencies) | `directory` (relative to repo root), `depth` (default 2), `project`, `repo` |
| `cbm_trace` | Trace inbound/outbound call paths through the graph | ★ `symbol`, `direction` (`inbound` \| `outbound` \| `both`, default `both`), `max_depth` (default 3), `project`, `repo` |
| `cbm_search_code` | Fast textual regex search over indexed files | ★ `query`, `file_pattern`, `limit` (default 50), `project`, `repo` |

Each tool forwards to the daemon's MCP `tools/call` method
(`list_projects`, `search_graph`, `get_code_snippet`, `get_architecture`,
`trace_path`, `search_code`) with a 120-second timeout; tool-level errors are
surfaced as failed tool results.

---

## Configuration

### Environment variables

| Variable | Effect |
|----------|--------|
| `CBM_EXE` | Explicit path to the `codebase-memory-mcp` binary (must exist; takes priority over every other lookup). |
| `CBM_DEFAULT_PROJECT` | Fallback project slug when neither `project` nor `repo` is passed to a tool. |

### Project resolution order

When a tool is called, the project is resolved as:

1. explicit `project` argument,
2. slug of the `repo` argument,
3. `CBM_DEFAULT_PROJECT`,
4. slug of the current working directory.

Slug mapping: `/home/user/my-repo` → `home-user-my-repo`; Windows paths keep a
drive prefix, e.g. `C:\Users\me\app` → `C-Users-me-app`.

### Daemon auto-start

The daemon starts eagerly when the plugin applies (unless the process runs
under `node --test`), and every tool call ensures it is running, so the child
process is restarted transparently if it dies. On plugin disposal the daemon is
killed together with any pending requests.

---

## Development & Testing

```bash
# Unit + integration test suite (node --test)
npm test

# Verify npm package packing
npm run pack:check
```

The suite covers path slugification, `findExe`/`CBM_EXE` lookup, the stdio
JSON-RPC client (spawn, handshake, tool calls, errors), tool registration, a full
`apply()` against a mocked Cordis context, and — when the real binary is
installed on the host — a live `list_projects` round trip (this test is skipped
otherwise). CI runs the suite on Ubuntu with Node 20, 22, and 24.

Repository layout:

```text
src/index.mjs        # Cordis plugin: apply(), system prompt, /cbm command
src/bridge.mjs       # stdio JSON-RPC client, executable discovery, cbm_* tools
src/skills.mjs       # bundled skill provider registration
skills/codebase-memory/SKILL.md   # agent-facing skill
cordis.patch.yml     # bundle patch that mounts the plugin
```

### Publishing

Every push to `main` runs the **Publish** workflow: it runs the test suite and
publishes the package to npm via Trusted Publishing (OIDC). If the current
version already exists, the workflow bumps the patch version and commits it back
with `[skip publish]` to avoid a loop; including `[skip publish]` anywhere in a
commit message skips the publish run entirely.

---

## License

[MIT](LICENSE) © 2025 LoveDoLove
