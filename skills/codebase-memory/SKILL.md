---
name: codebase-memory
description: "Use the codebase knowledge graph for structural code queries. Triggers on: explore the codebase, understand the architecture, what functions exist, show me the structure, who calls this function, what does X call, trace the call chain, find callers of, show dependencies, impact analysis, dead code, unused functions, high fan-out, refactor candidates, code quality audit, graph query syntax, Cypher query examples, edge types, how to use search_graph."
---

# Codebase Memory — Knowledge Graph Tools

Graph tools return precise structural results in ~500 tokens vs ~80K for grep.
Web visual graph interface: http://localhost:9749/

## Quick Decision Matrix

| Question | Tool call |
|----------|----------|
| Who calls X? | `cbm_trace(symbol="...", direction="inbound")` |
| What does X call? | `cbm_trace(symbol="...", direction="outbound")` |
| Full call context | `cbm_trace(symbol="...", direction="both")` |
| Find by name pattern | `cbm_search(name_pattern="...")` |
| Read source snippet | `cbm_snippet(qualified_name="...")` |
| Directory architecture | `cbm_arch(directory="...")` |
| Text search in repo | `cbm_search_code(query="...")` |
| List indexed projects | `cbm_projects()` |

## Exploration Workflow
1. `cbm_projects()` — check if project is indexed
2. `cbm_search(label="Function", name_pattern=".*Pattern.*")` — find code entities
3. `cbm_snippet(qualified_name="project.path.FuncName")` — read exact symbol source
4. `cbm_arch(directory="src")` — inspect component relationships

## Tracing Workflow
1. `cbm_search(name_pattern=".*FuncName.*")` — discover exact name
2. `cbm_trace(symbol="FuncName", direction="both", max_depth=3)` — trace call graph
