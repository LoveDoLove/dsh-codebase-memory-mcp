# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9] - 2026-11-12

### Added
- `Config` Schemastery schema, exported on the default export. `exePath`, `uiEnabled`, `port` and `eagerStart` are now settable from `cordis.yml` and validated at startup. `DEFAULT_UI_PORT` is the source of truth for the default port, and the guidance text, `/cbm` output and startup banner all use the configured value instead of a hardcoded `9749`.

### Fixed
- `exec.signal` is honoured end to end. Cancelling a `cbm_*` tool call aborts the in-flight JSON-RPC request, rejects with an `AbortError`, and clears the pending entry and its timer. Previously the signal was dropped and a cancelled call kept running until the 60s rpc timeout.
- A failed registration of the optional `systemPrompt`, `skills` or `commands` capability now logs a warning instead of disappearing into an empty `catch`.
- `engines.dsh` declares the supported harness range (`>=0.2.0 <0.3.0`), so an incompatible DSH refuses the install instead of loading a plugin that calls APIs it does not have.

### Changed
- `registerCbmTools()` returns the canonical value declared by each tool's `output.schema`. The `legacyText` mode that flattened those values to strings is removed, along with the bridge option that enabled it. Text rendering belongs to `output.render`, as the tool contract specifies.
- Dropped the dead `dsh.compatibility` block from `package.json`; nothing reads it. Peer floors moved to the DSH versions that actually provide the APIs in use.
- Removed the unused `toRawOutputSchema` helper.
- CI installs dependencies before `npm test`, because the plugin now has a runtime dependency.

## [0.1.8] - 2026-11-12

### Fixed
- The autostart notice now reaches the terminal. It was sent through `ctx.logger`, and a `dsh web` boot installs no console exporter on the logger, so the message stayed in an in-memory buffer: the daemon was up while `dsh web` printed nothing. The notice is written to **stderr**, not stdout, because ACP profiles frame their protocol on stdout.
- A missing executable now says so on the same channel (`codebase-memory-mcp executable not found; the graph UI stays off`). Previously the plugin returned silently, which looked identical to "nothing needed to start".

### Changed
- `autoStartCodebaseMemory()` owns the availability check and warns on a missing binary. `cbmApply()` no longer pre-filters the call, so the warning cannot be bypassed.

## [0.1.7] - 2026-11-12

### Fixed
- `dsh web` (and every other DSH app) starts the `codebase-memory-mcp` daemon at plugin load again. The 0.1.5 extraction rewrite replaced `cbmApply()` with a bare `getOrCreateCodeClient()` call, which only constructed the client and never spawned the process, so the graph UI at `http://localhost:9749/` stayed dark until an agent happened to call a `cbm_*` tool.
- `/cbm` no longer throws `ReferenceError: findExe is not defined`. The handler referenced `findExe()` and `getOrCreateClient()` without importing them.
- `test/dsh-services.test.mjs` mounts the real native tool executor, so prompt assembly no longer fails with `ToolExecutorUnavailableError` on the host stack.

### Added
- `test/apply-autostart.test.mjs` pins the regression: `apply()` must spawn the daemon with `--ui=true --port=9749`.

## [0.1.5] - 2026-11-02

### Added
- Complete Codebase Memory core implemented in this standalone package:
  - `src/types.mjs`: constants for indexing, freshness, entities, relations, directions.
  - `src/client.mjs`: stdio JSON-RPC client, executable discovery, and daemon lifecycle management.
  - `src/discovery.mjs`: path traversal protection, gitignore parser, sensitive/secret detection, and repo discovery.
  - `src/engine.mjs`: `CodeIntelligenceEngine` for indexing, search, snippet extraction, architecture, and status.
  - `src/watcher.mjs`: `RepositoryWatcher` for debounced incremental file watching.
  - `src/tools.mjs`: full definitions and execution handlers for all 6 `cbm_*` tools.
  - `src/redact.mjs`: sensitive pattern scrubber and content sanitizer.
- Re-exported modular APIs (`@lovedolove/dsh-codebase-memory-mcp/client`, `/discovery`, `/engine`, `/tools`, `/types`, `/watcher`).
- Comprehensive unit tests covering all extracted modules.

## [0.1.0] - 2025-09-30

### Added
- Standalone DSH plugin for `codebase-memory-mcp` integration.
- Background daemon lifecycle management with the `--ui=true` Web UI (started lazily on first request).
- Web knowledge graph visualization UI hosted at `http://localhost:9749/`.
- Full set of 6 MCP tools registered into DSH:
  - `cbm_projects`: List indexed projects.
  - `cbm_search`: Search code knowledge graph by name, label, or path.
  - `cbm_snippet`: Retrieve precise source code snippet for qualified symbols.
  - `cbm_arch`: Directory architectural summary.
  - `cbm_trace`: Trace inbound and outbound call graph paths.
  - `cbm_search_code`: Fast textual search across repository files.
- Cross-platform executable detection (Linux, macOS, Windows, and WSL).
- Bundled `codebase-memory` skill for DeepSeek Harness agent.
- Slash command `/cbm` to inspect daemon status, executable path, and indexed projects.
- Automated CI and npm publishing GitHub Actions workflow.
