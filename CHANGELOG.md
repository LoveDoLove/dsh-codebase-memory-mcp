# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
