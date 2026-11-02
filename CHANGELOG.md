# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-11-02

### Added
- Complete Codebase Memory core extracted from Veyra:
  - `src/types.mjs`: constants for indexing, freshness, entities, relations, directions.
  - `src/client.mjs`: stdio JSON-RPC client, executable discovery, and daemon auto-start.
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
- Background daemon auto-start on plugin initialization (`--ui=true`).
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
