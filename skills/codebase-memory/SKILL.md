---
name: codebase-memory
description: >
  Use Codebase Memory for structural code intelligence, AST-level navigation,
  call-graph tracing, and knowledge-graph code search. Prefer cbm_trace for caller/callee
  analysis, cbm_search for symbol discovery, cbm_snippet for exact definitions, and cbm_arch
  for component dependency overview. Provides precise structural graph vs noisy text search.
whenToUse: >
  Understanding repository structure, finding symbol definitions, tracing call hierarchies,
  analyzing blast radius / impact of code changes, or directory component architecture.
---

# Codebase Memory — Structural Code Intelligence

Codebase Memory provides structural AST-level code intelligence and call-graph
navigation from an existing codebase-memory-mcp index.

Web visual graph interface: http://localhost:9749/

The daemon starts when the plugin applies, so a `dsh web` boot already has a
live UI at that address. Set `eagerStart: false` in the plugin config to defer
the start to the first tool call. The six tools always exist; if the
`codebase-memory-mcp` executable is missing, calls return a degraded result.

## Quick Decision Matrix

| Question | Tool call |
|----------|----------|
| Who calls X? | `cbm_trace(symbol="X", direction="inbound")` |
| What does X call? | `cbm_trace(symbol="X", direction="outbound")` |
| Full call context | `cbm_trace(symbol="X", direction="both")` |
| Find by name pattern | `cbm_search(name_pattern="...")` |
| Read source snippet | `cbm_snippet(qualified_name="...")` |
| Directory architecture | `cbm_arch(directory="src")` |
| Text search in repo | `cbm_search_code(query="...")` |
| List indexed projects | `cbm_projects(reason="...")` |

## Exploration Workflow

1. `cbm_projects(reason="...")` — list indexed projects. Use a returned project
   name as `project`, or pass the repository root as `repo`; tools otherwise
   infer the project from the working directory.
2. `cbm_arch(directory="src")` — understand directory component dependencies
   and the architecture overview.
3. `cbm_search(name_pattern=".*Pattern.*", label="Function")` — find symbols.
4. `cbm_snippet(qualified_name="...")` — read exact symbol definitions with
   minimal token overhead.

## Tracing Workflow

1. `cbm_search(name_pattern=".*FuncName.*")` — discover the exact symbol name.
2. `cbm_trace(symbol="FuncName", direction="both", max_depth=3)` — trace call
   hierarchies. `direction` is `inbound`, `outbound`, or `both`.

## Tools

- `cbm_projects`: List all projects currently indexed in codebase-memory-mcp.
  Requires `reason`, a short explanation for the tool call.
- `cbm_search`: Discover functions, classes, interfaces, or files by name
  pattern, AST label, or file path pattern. Optional `limit` defaults to 50.
- `cbm_snippet`: Retrieve exact symbol definitions and their immediate context
  without reading whole files.
- `cbm_trace`: Trace inbound/outbound call paths through the knowledge graph
  from a specific symbol.
- `cbm_arch`: Directory-level component dependency and architectural overview.
- `cbm_search_code`: Fast regex search across indexed repository files.

Most tools accept `project` (explicit project slug) and `repo` (repository root
path, slugified automatically). Resolution order is explicit `project`, then the
slug of `repo`, then the slug of the working directory.

## Result Quality

- Graph results are structural but can be stale if the index has not been
  refreshed. Verify material claims with `cbm_snippet` or by reading the source.
- The six tools do not expose pagination, generation, freshness, or coverage
  metadata. Do not claim that a result set is exhaustive, that a symbol has no
  callers, or that a path is dead code based only on one graph query.
- For negative or exhaustive claims, run the relevant trace directions, inspect
  the candidate files, and state any remaining uncertainty.
- `cbm_search_code` searches indexed files; generated, vendored, binary, and
  sensitive files may be excluded by repository discovery rules.

## When to Use Codebase Memory vs grep

- Use `cbm_trace` for caller/callee relationships, call hierarchies, and
  blast-radius analysis.
- Use `cbm_search` to discover functions, classes, interfaces, or files by name
  pattern or AST label.
- Use `cbm_snippet` for exact definitions and immediate context.
- Use `cbm_arch` for directory-level component dependencies.
- Use `grep`/`read` when editing files, reading non-code assets, or searching
  exact string literals.

## Bridge Limitations

- `cbm_snippet` accepts `end_line` but the current bridge forwards only
  `qualified_name` and `start_line`; use `start_line` and rely on the daemon's
  normal snippet context.
- `cbm_arch` accepts `depth` but the current client forwards only the project
  and path, so the daemon's default depth is used.
- Indexing is not exposed as a tool. The plugin only queries an existing index;
  use the library API or the upstream CLI to build or refresh it.

## Missing Executable

If a call reports that Code Intelligence is degraded or the executable is not
found, install `codebase-memory-mcp` and set `CBM_EXE` (or
`CODEBASE_MEMORY_EXE`) if it is not on `PATH`. The executable path is resolved
when the plugin loads, so reload the profile after installing it.

## Core Rules

- Prefer graph tools for structure and `cbm_snippet` for exact code.
- Do not invent symbol names; search first, then trace or snippet.
- Do not use the graph as a substitute for reading the code you are about to
  change.
- Report degraded results and missing indexes explicitly instead of guessing.
