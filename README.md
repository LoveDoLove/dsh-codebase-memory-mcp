# @lovedolove/dsh-codebase-memory-mcp

> Standalone **Codebase Memory MCP bridge plugin and library** for DeepSeek
> Harness (DSH). Registers six knowledge-graph code tools, manages a lazily
> started `codebase-memory-mcp` daemon with its graph-visualization Web UI, and
> ships a bundled agent skill plus a `/cbm` status command.

[![npm version](https://img.shields.io/npm/v/@lovedolove/dsh-codebase-memory-mcp.svg)](https://www.npmjs.com/package/@lovedolove/dsh-codebase-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/LoveDoLove/dsh-codebase-memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/LoveDoLove/dsh-codebase-memory-mcp/actions/workflows/ci.yml)
[![M8ven Score](https://m8ven.ai/badge/mcp/lovedolove/dsh-codebase-memory-mcp)](https://m8ven.ai/mcp/lovedolove/dsh-codebase-memory-mcp?s=readme)

---

## Features

- **Six knowledge-graph code tools** registered on the DSH tool surface:
  `cbm_projects`, `cbm_search`, `cbm_snippet`, `cbm_arch`, `cbm_trace`, and
  `cbm_search_code`.
- **Lazy daemon and Web UI** — the plugin does not start the daemon while it is
  loading. The shared client spawns `codebase-memory-mcp --ui=true --port=9749`
  as a child process over stdio JSON-RPC 2.0 the first time a tool call or
  `/cbm` needs it. If the child exits, the next request starts it again; the
  client disposes it when the plugin shuts down.
- **System-prompt guidance** — injects a *Codebase Memory — Knowledge Graph
  Policy* section that tells the model when to prefer the graph tools over
  `grep`/`read`.
- **Bundled agent skill** — [`skills/codebase-memory/SKILL.md`](skills/codebase-memory/SKILL.md)
  is registered as a native bundled skill provider (`codebase-memory`, rank 600,
  model- and user-invocable), so the model-facing `skill` tool can load it.
- **`/cbm` slash command** — reports the resolved executable path, the Web UI
  link, and the projects currently indexed in the daemon.
- **Graceful degradation** — only `tools` is a hard dependency
  (`inject: ['tools']`); `systemPrompt`, `skills`, and `commands` are attached via
  deferred `ctx.inject()`, so a missing host service simply skips that feature.
  The six tools are registered even when the executable is absent; calls return
  a degraded result instead of failing to load the plugin.
- **Cross-platform executable detection** — `CBM_EXE` and
  `CODEBASE_MEMORY_EXE` overrides, user and system directories, current working
  directory, `PATH`, and a WSL interop fallback that locates
  `codebase-memory-mcp.exe` reachable from Linux/WSL.
- **Reusable library API** — the package exports the MCP client, indexing engine,
  repository discovery, sanitization, watcher, tool definitions, and type
  constants, so the bridge can be used without the DSH plugin layer.

---

## Requirements

| Component | Version |
|-----------|---------|
| DeepSeek Harness | `>=0.1.2-rc.1 <0.3.0-0` (`dsh.compatibility.dshVersions`) |
| Node.js | `>=18 <25` (`engines`) |
| `codebase-memory-mcp` executable | any recent release |

Optional peer dependencies (declared in `peerDependencies`, resolved from the DSH
runtime when present): `@deepseek-ai/cordis` `>=4.0.1-rc.1 <5.0.0-0`, and
`@deepseek-ai/dsh-commands`, `@deepseek-ai/dsh-skill`,
`@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools` `>=0.1.2-rc.1 <0.3.0-0`.

> **The executable is required for queries, not for loading the plugin.** The
> plugin registers the `cbm_*` tools at load time. If no executable is found,
> tool calls return a degraded result and `/cbm` prints an installation hint.
> The executable path is resolved when the shared client is constructed, so after
> installing the binary you must reload the DSH profile for the plugin to find it.

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

Or point the plugin at it explicitly with `CBM_EXE=/path/to/codebase-memory-mcp`
(or `CODEBASE_MEMORY_EXE`).

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

On plugin load you will see the tool registration log:

```text
[codebase-memory] registered tools: cbm_projects, cbm_search, cbm_snippet, cbm_arch, cbm_trace, cbm_search_code
[codebase-memory] registered system prompt guidance
[codebase-memory] registered /cbm command
[codebase-memory] registered skill: codebase-memory
```

The daemon and its Web UI are **not** started at this point. They start on the
first tool call or when `/cbm` runs. The plugin itself does not print a UI
banner; the optional `autoStartCodebaseMemory()` helper (used by the legacy
bridge) logs:

```text
[codebase-memory] 🔍 codebase-memory UI is live: http://localhost:9749/
```

---

## Usage

### Let the agent use it

The plugin injects the knowledge-graph policy into the system prompt and bundles
the `codebase-memory` skill, so the agent picks the right tool on its own.
Typical workflow:

1. `cbm_projects(reason="...")` — confirm the project is indexed. The tool
   requires a short `reason` string for the tool-call card.
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
| List indexed projects | `cbm_projects(reason="...")` |

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
served at **http://localhost:9749/** by default. The client can use another port
when constructed directly (`new CodebaseMemoryClient({ port })`), but the DSH
plugin uses the default 9749, and its prompts and `/cbm` output assume that port.

---

## Available Tools

The six tools return text. Most accept `repo` (repository root path, slugified
automatically) and `project` (explicit project slug); `cbm_projects` takes only
`reason`. Project and repository resolution is described under
[Configuration](#configuration).

| Tool | Description | Arguments (★ = required) |
|------|-------------|--------------------------|
| `cbm_projects` | List all projects indexed in the daemon | ★ `reason` |
| `cbm_search` | Search the knowledge graph for symbols or files | `name_pattern`, `label` (`Function` \| `Class` \| `Interface` \| `File`), `file_path_pattern`, `limit` (default 50), `project`, `repo` |
| `cbm_snippet` | Fetch the exact source snippet of a symbol | ★ `qualified_name`, `file_path`, `start_line`, `end_line`, `project`, `repo` |
| `cbm_arch` | Architectural summary of a directory (components, entry points, dependencies) | `directory` (relative to repo root), `depth` (default 2), `project`, `repo` |
| `cbm_trace` | Trace inbound/outbound call paths through the graph | ★ `symbol`, `direction` (`inbound` \| `outbound` \| `both`, default `both`), `max_depth` (default 3), `project`, `repo` |
| `cbm_search_code` | Fast textual regex search over indexed files | ★ `query`, `file_pattern`, `limit` (default 50), `project`, `repo` |

Each tool forwards to the daemon's MCP `tools/call` method
(`list_projects`, `search_graph`, `get_code_snippet`, `get_architecture`,
`trace_path`, `search_code`). The client's default JSON-RPC timeout is 60
seconds; tool-level errors are surfaced as failed tool results.

### Bridge behavior and limitations

- `cbm_snippet` accepts `end_line` for schema compatibility, but the current
  bridge forwards only `qualified_name` and `start_line` to the daemon. Use
  `start_line` and let the daemon return its normal snippet context.
- `cbm_arch` accepts `depth`, but the current client forwards only the project
  and path; the daemon's default depth is used.
- Indexing is **not** exposed as a `cbm_*` tool. The DSH plugin is query-only;
  use the library API or the upstream CLI to build or refresh an index.
- Tool results are text. No pagination, generation, freshness, or coverage
  metadata is exposed through these six tools.

---

## Configuration

### Environment variables

| Variable | Effect |
|----------|--------|
| `CBM_EXE` | Explicit path to the `codebase-memory-mcp` binary (must exist; takes priority over every other lookup). |
| `CODEBASE_MEMORY_EXE` | Secondary explicit path, checked after `CBM_EXE`. |
| `DSH_HOME` | Base directory for the plugin's index-status metadata. Defaults to `~/.dsh`. |

### Project resolution order

When a tool is called, the repository root is `repo` if supplied, otherwise the
session working directory. The project is then resolved as:

1. explicit `project` argument,
2. slug of the repository root,
3. slug of the current working directory.

Slug mapping: `/home/user/my-repo` → `home-user-my-repo`; Windows paths keep a
drive prefix, e.g. `C:\Users\me\app` → `C-Users-me-app`.

### Daemon lifecycle

The client starts the daemon lazily on the first RPC (`ensureStarted`), not when
the plugin applies. Every tool call ensures the child is running, so the next
call starts it again if it has died. On plugin disposal the client is disposed,
which kills the daemon and rejects any pending requests. The client also exposes
`uiEnabled: false` for headless library use (`--ui=false`).

### Index-status storage

The engine persists only index status metadata, not the graph itself:

```text
$DSH_HOME/codebase-memory/projects/<projectId>/code_index.json
```

When `DSH_HOME` is unset the path is
`~/.dsh/codebase-memory/projects/<projectId>/code_index.json`. A library caller
can override the base directory with `config.home` or supply
`config.getMetadataPath(repoRoot)`.

---

## Library API

The package is usable without DSH. The core modules are re-exported from the
package root, and the same modules are available through subpath exports (the
legacy bridge has its own `./bridge` subpath):

```js
import {
  CodebaseMemoryClient,
  CodeIntelligenceEngine,
  discoverRepository,
  cbmProjectName,
  sanitizeCodeContent,
  RepositoryWatcher,
  createCbmToolDefinitions,
  DEFAULT_UI_PORT,
} from '@lovedolove/dsh-codebase-memory-mcp'
```

```js
const client = new CodebaseMemoryClient()          // resolves the executable
const engine = new CodeIntelligenceEngine({ client })

const repo = process.cwd()
await engine.indexRepository(repo, { mode: 'fast' })

const found = await engine.searchSymbols(repo, { name_pattern: '.*auth.*' })
const trace = await engine.traceCallPath(repo, { symbol: 'login', direction: 'both' })

client.dispose()
```

Key exports:

| Export | Purpose |
|--------|---------|
| `CodebaseMemoryClient` | Spawns and talks to the daemon over stdio JSON-RPC 2.0. |
| `getOrCreateCodeClient`, `resetSharedCodeClient`, `createClient` | Shared-client helpers. |
| `CodeIntelligenceEngine` | Index lifecycle, status metadata, discovery, and sanitized query wrappers. |
| `discoverRepository`, `cbmProjectName`, `resolveSafeRepoPath`, `isSensitiveOrSecret`, `isBinaryFile`, `parseGitignoreContent`, `matchesGitignore` | Repository discovery and safety helpers. |
| `sanitizeCodeContent`, `scrub`, `redact` | Secret scrubbing for returned code. |
| `RepositoryWatcher`, `closeAllWatchers` | Debounced recursive file watcher. |
| `createCbmToolDefinitions`, `registerCbmTools` | DSH tool definitions and registration. |
| `INDEX_STATUS`, `FRESHNESS_STATUS`, `CODE_ENTITY_TYPES`, `CODE_RELATIONS`, `TRACE_DIRECTIONS`, `DEFAULT_UI_PORT` | Shared constants. |

Subpath exports: `./client`, `./discovery`, `./engine`, `./tools`, `./types`,
`./watcher`, and the legacy `./bridge`.

### Indexing behavior

`CodeIntelligenceEngine.indexRepository(repoRoot, opts)` deduplicates concurrent
requests for the same repository, moves status through `indexing` / `updating`,
runs `discoverRepository` to apply exclusions, sensitive-file rules, and
`.gitignore`, then asks the daemon to index the repository. The final state is
persisted as `ready`, `degraded`, or `error`. `indexIncremental(repoRoot)` is a
`mode: 'fast'` alias. If the executable is unavailable, the operation returns a
`degraded` status without throwing.

`discoverRepository` skips VCS directories, dependency/build output directories,
caches, coverage output, sensitive files (`.env*`, keys, certificates), binary
extensions, and files larger than 2 MiB.

---

## Development & Testing

```bash
# Unit + integration test suite (node --test)
npm test

# Verify the published file set without publishing
npm run pack:check
```

The suite covers slugification, executable discovery and `CBM_EXE`, the JSON-RPC
client, tool registration, the full plugin `apply` against a mocked Cordis
context, and the DSH service integrations. A live `list_projects` check runs
when a real executable is installed and is skipped otherwise. CI runs the suite
on Node 20, 22, and 24.

### Repository layout

```text
src/
  index.mjs       Plugin entry: apply(), guidance, /cbm, re-exports
  client.mjs      Executable discovery + stdio JSON-RPC daemon client
  engine.mjs      Index lifecycle, status metadata, query wrappers
  discovery.mjs   Repo walk, ignore rules, sensitive/binary filtering
  redact.mjs      Secret scrubbing and content sanitization
  tools.mjs       Six cbm_* DSH tool definitions and registration
  skills.mjs      Bundled skill provider
  watcher.mjs     Debounced recursive repository watcher
  types.mjs       Shared constants
  bridge.mjs      Legacy compatibility re-exports
skills/
  codebase-memory/SKILL.md
test/             node:test suites for each module and DSH integration
```

---

## Publishing

Every push to `main` runs the **Publish** workflow: it runs the test suite, then
publishes with npm Trusted Publishing (OIDC). If the current version already
exists on npm, the workflow bumps the patch version, commits the bump with
`[skip publish]`, and publishes the new version. A commit whose message contains
`[skip publish]` skips publishing.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `codebase-memory-mcp executable not found` | Install the executable, set `CBM_EXE` (or `CODEBASE_MEMORY_EXE`), and reload the DSH profile. |
| Tools return `Code Intelligence Degraded` | The binary is missing or failed to start. Check the path and run `codebase-memory-mcp --version`. |
| Web UI is not reachable | The daemon starts lazily. Call a `cbm_*` tool or `/cbm` first, then open http://localhost:9749/. |
| Project not found / empty results | Confirm the repository is indexed (`cbm_projects(reason="...")`) and pass the correct `project` slug or `repo` path. |
| No symbols after indexing | The plugin does not index automatically; build the index through the library API or the upstream CLI. |

## License

MIT — see [LICENSE](LICENSE).
