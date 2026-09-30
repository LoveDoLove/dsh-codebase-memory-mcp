# @lovedolove/dsh-codebase-memory-mcp

> Standalone Codebase Memory MCP bridge plugin for DeepSeek Harness (DSH).
> Provides structural knowledge-graph code search, AST snippets, architecture analysis, call-path tracing, and auto-started graph visualization UI.

[![npm version](https://img.shields.io/npm/v/@lovedolove/dsh-codebase-memory-mcp.svg)](https://www.npmjs.com/package/@lovedolove/dsh-codebase-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/LoveDoLove/dsh-codebase-memory-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/LoveDoLove/dsh-codebase-memory-mcp/actions/workflows/ci.yml)

---

## Features

- **Knowledge-Graph Code Tools (~500 tokens vs ~80K for grep)**:
  - `cbm_projects`: List all indexed projects in the MCP knowledge graph.
  - `cbm_search`: Search symbols, classes, functions, or files by pattern, label, or path.
  - `cbm_snippet`: Retrieve the exact source snippet for a qualified name.
  - `cbm_arch`: High-level structural architectural overview of a directory.
  - `cbm_trace`: Trace inbound/outbound call-graph paths from any function or symbol.
  - `cbm_search_code`: Fast textual search across indexed files.
- **Auto-Started Background Daemon & Web UI**:
  - Automatically launches the `codebase-memory-mcp` daemon with `--ui=true` on DSH boot.
  - Web knowledge graph visualization UI available at **`http://localhost:9749/`**.
- **Bundled Agent Skill**:
  - Includes the `codebase-memory` agent skill ready to instruct DSH on using graph tools effectively.
- **Slash Command**:
  - `/cbm` command to quickly inspect daemon health, executable location, and indexed projects.
- **Cross-Platform Compatibility**:
  - Fully tested on **Linux**, **WSL** (Windows Subsystem for Linux), and **Windows**.
  - Automatic detection in `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, Windows `AppData/Local/Programs`, current working directory, and system `PATH`.
  - Override path anytime with `CBM_EXE=/path/to/codebase-memory-mcp`.

---

## Installation

### 1. Install `codebase-memory-mcp` CLI
Ensure the `codebase-memory-mcp` binary is installed on your machine.
For example, download the release for your platform or place it in `~/.local/bin/` or your system `PATH`.

```bash
# Verify it runs
codebase-memory-mcp --help
```

### 2. Install the Plugin in DeepSeek Harness

In your DSH environment:

```bash
npm install @lovedolove/dsh-codebase-memory-mcp
```

Add the plugin to your `cordis.patch.yml` or DSH plugin configuration:

```yaml
- insert:
    - id: dsh-codebase-memory-mcp
      name: '@lovedolove/dsh-codebase-memory-mcp'
```

When DSH starts, you will see:
```text
[codebase-memory] 🔍 codebase-memory UI is live: http://localhost:9749/
```

---

## Tool Reference

| Tool | Description | Key Arguments |
|------|-------------|---------------|
| `cbm_projects` | List indexed repositories | (none) |
| `cbm_search` | Search graph for symbols or files | `name_pattern`, `label`, `file_path_pattern` |
| `cbm_snippet` | Extract source code for symbol | `qualified_name`, `file_path`, `start_line`, `end_line` |
| `cbm_arch` | Directory architecture summary | `directory`, `depth` |
| `cbm_trace` | Trace call graph paths | `symbol`, `direction` (`inbound`\|`outbound`\|`both`), `max_depth` |
| `cbm_search_code` | Text regex search | `query`, `file_pattern`, `limit` |

---

## Environment Variables

- `CBM_EXE`: Explicit path to the `codebase-memory-mcp` binary.
- `CBM_DEFAULT_PROJECT`: Default project slug (defaults to slug generated from current working directory).

---

## Development & Testing

```bash
# Run unit & integration test suite
npm test

# Verify npm package packing
npm run pack:check
```

---

## License

[MIT](LICENSE) © 2025 LoveDoLove
