# Tool reference

The plugin `@lovedolove/dsh-codebase-memory-mcp` registers six `cbm_*` tools with DSH. The definitions live in `src/tools.mjs`, and each tool forwards to a matching upstream MCP tool through `src/engine.mjs` and `src/client.mjs`.

All six tools return text. Five of them accept a `repo` argument for the repository root path and a `project` argument for an explicit project slug. `cbm_projects` takes neither. When you omit `project`, the engine derives it from `repo` or from the workspace directory.

## cbm_projects

Lists the projects that the codebase-memory daemon currently has indexed.

| Argument | Type | Required | Default | Meaning |
|----------|------|----------|---------|---------|
| `reason` | string | yes | none | Brief explanation of why you are calling this tool |

The tool returns the daemon's project list as text. `reason` reaches the tool card only and is not sent upstream. The engine returns `{ ok, raw }` on success. The rendered text is `No projects indexed.` when the daemon returns an empty list or an empty string.

## cbm_search

Searches the code knowledge graph for symbols, functions, classes, and files.

| Argument | Type | Required | Default | Meaning |
|----------|------|----------|---------|---------|
| `name_pattern` | string | no | none | Regex or substring filter on node names |
| `label` | string | no | none | Node label filter, one of `Function`, `Class`, `Interface`, `File` |
| `file_path_pattern` | string | no | none | Regex filter on the file path |
| `project` | string | no | derived from `repo` | Project name, for example `C-repos-myproject` |
| `repo` | string | no | session workspace | Repository root path, used when the project name is not known |
| `limit` | number | no | `50` | Maximum number of results |

The engine maps `name_pattern` to the upstream `name_pattern` field, maps `file_path_pattern` to the upstream `file_pattern` field, and falls back to `50` for `limit`. The result is `{ ok, raw, message }`, where `raw` holds the daemon text and `message` repeats it. The render step prints `raw`, then `No matching symbols found.` when the call succeeded with no text, then `message`, then `Search failed.`.

## cbm_snippet

Returns the exact source text of a qualified symbol.

| Argument | Type | Required | Default | Meaning |
|----------|------|----------|---------|---------|
| `qualified_name` | string | yes | none | Full qualified name of the symbol, for example `app.auth.login` |
| `file_path` | string | no | none | File that contains the symbol |
| `start_line` | number | no | none | First line of the snippet, 1 based |
| `end_line` | number | no | none | Last line of the snippet, not forwarded |
| `project` | string | no | derived from `repo` | Project name |
| `repo` | string | no | session workspace | Repository root path |

The engine checks `file_path` against the repository root before the call and returns `File path outside repository boundary` when the path resolves outside it. On success the tool returns `{ ok, snippet }`, with the text passed through `sanitizeCodeContent`. The rendered text is `No snippet available.` when the snippet is empty and the message is absent.

`end_line` has no effect. The tool schema declares it, and the engine does not read it. The engine builds the upstream call from `qualified_name`, `start_line`, and `max_lines`, and `src/client.mjs` forwards `qualified_name`, `start_line`, and `max_lines`. The schema exposes `start_line` and `end_line` and does not expose `max_lines`, so only `start_line` reaches the daemon from the declared arguments.

## cbm_trace

Traces call paths through the graph from one symbol.

| Argument | Type | Required | Default | Meaning |
|----------|------|----------|---------|---------|
| `symbol` | string | yes | none | Symbol or function name to trace from |
| `direction` | string | no | `both` | Trace direction, one of `inbound`, `outbound`, `both` |
| `max_depth` | number | no | `3` | Maximum number of hops |
| `project` | string | no | derived from `repo` | Project name |
| `repo` | string | no | session workspace | Repository root path |

The engine maps `symbol` to the upstream `function_name` field and `max_depth` to the upstream `depth` field. On success the tool returns `{ ok, raw }`. The render step prints `raw`, then `No call paths found.` when the call succeeded with no text, then `message`, then `Trace failed.`.

## cbm_arch

Summarizes the architecture of a directory.

| Argument | Type | Required | Default | Meaning |
|----------|------|----------|---------|---------|
| `directory` | string | no | repository root | Subdirectory to analyze, relative to the repository root |
| `depth` | number | no | `2` | Analysis depth |
| `project` | string | no | derived from `repo` | Project name |
| `repo` | string | no | session workspace | Repository root path |

The engine maps `directory` to the upstream `path` field. On success the tool returns `{ ok, overview }`. The render step prints `overview`, then `raw`, then `No architectural summary available.` when the call succeeded with no text, then `message`, then `Arch query failed.`.

`depth` does not reach the daemon. The engine passes it to `src/client.mjs`, and `getArchitecture` in that file sends only `project` and `path` in the upstream payload.

## cbm_search_code

Searches indexed file text with a regular expression.

| Argument | Type | Required | Default | Meaning |
|----------|------|----------|---------|---------|
| `query` | string | yes | none | Search term or regular expression |
| `file_pattern` | string | no | none | Glob or regex that restricts the file paths |
| `limit` | number | no | `50` | Maximum number of results |
| `project` | string | no | derived from `repo` | Project name |
| `repo` | string | no | session workspace | Repository root path |

The engine maps `query` to the upstream `pattern` field. On success the tool returns `{ ok, results }`, with the text passed through `sanitizeCodeContent`. The rendered text is `No matches found.` when the result text is empty and the call succeeded, and `message` or `Search failed.` otherwise.

## Upstream argument mapping

The engine renames arguments before it calls the daemon, and `src/client.mjs` builds the final payload. This table lists the field each argument becomes.

| Tool | Declared argument | Upstream field |
|------|-------------------|----------------|
| `cbm_projects` | `reason` | not sent |
| `cbm_search` | `name_pattern` | `name_pattern` |
| `cbm_search` | `file_path_pattern` | `file_pattern` |
| `cbm_search` | `label`, `limit`, `project` | same name |
| `cbm_snippet` | `qualified_name` | `qualified_name` |
| `cbm_snippet` | `start_line` | `start_line` |
| `cbm_snippet` | `end_line` | not sent |
| `cbm_snippet` | `file_path` | checked against the repository root, not sent |
| `cbm_trace` | `symbol` | `function_name` |
| `cbm_trace` | `max_depth` | `depth` |
| `cbm_trace` | `direction` | `direction` |
| `cbm_arch` | `directory` | `path` |
| `cbm_arch` | `depth` | not sent by the client |
| `cbm_search_code` | `query` | `pattern` |
| `cbm_search_code` | `file_pattern`, `limit` | same name |

The engine reads several aliases that the schema does not declare. `cbm_search` also reads `query` and `filePattern`, `cbm_snippet` reads `filePath`, `startLine`, `maxLines`, `qualifiedName`, and `symbol`, `cbm_trace` reads `function_name` and `maxDepth`, and `cbm_arch` reads `path`. A caller who passes only declared arguments sees the mapping above.

## Degraded results

The plugin reports a missing executable in a uniform shape. Every tool returns an object with `ok` and `degraded` when the executable is absent, and every tool except `cbm_projects` also returns `message`. The engine sets `ok` to `false` and `degraded` to `true`, and it sets `message` to `Code intelligence degraded` for the five tools that carry the field. Each render function checks `degraded` first and prints the exact text `Code Intelligence Degraded: <message>`, and it prints `Service unavailable` when the message is empty or absent. That fallback is what `cbm_projects` renders, because its degraded result omits `message`.

Each tool has its own empty-state string for a successful call that produced no text.

| Tool | Empty state |
|------|-------------|
| `cbm_projects` | `No projects indexed.` |
| `cbm_search` | `No matching symbols found.` |
| `cbm_snippet` | `No snippet available.` |
| `cbm_trace` | `No call paths found.` |
| `cbm_arch` | `No architectural summary available.` |
| `cbm_search_code` | `No matches found.` |

## Trace directions

`TRACE_DIRECTIONS` in `src/types.mjs` defines the accepted values for the `direction` argument of `cbm_trace`.

| Value | Meaning |
|-------|---------|
| `inbound` | Callers of the target symbol |
| `outbound` | Callees of the target symbol |
| `both` | Callers and callees |

The default is `both`. The engine reads the depth from `depth`, then `max_depth`, then `maxDepth`, and falls back to `3`.

## Label filter values

The `label` argument of `cbm_search` filters graph nodes by entity kind. The schema documents four values.

| Value | Entity kind |
|-------|-------------|
| `Function` | Functions |
| `Class` | Classes |
| `Interface` | Interfaces |
| `File` | Files |

The engine passes `label` to the daemon unchanged and does not validate it. `CODE_ENTITY_TYPES` in `src/types.mjs` defines a wider set of entity names that graph results can carry, which adds `Module`, `Method`, `Type`, and `Variable` to the four filter values above.

## Choosing a tool

| Question | Tool call |
|----------|-----------|
| Which projects are indexed? | `cbm_projects` with `reason` |
| Which symbols match a name? | `cbm_search` with `name_pattern` |
| What is the source of a symbol? | `cbm_snippet` with `qualified_name` |
| Who calls a function? | `cbm_trace` with `symbol` and `direction: "inbound"` |
| What does a directory contain? | `cbm_arch` with `directory` |
| Which files contain a string? | `cbm_search_code` with `query` |
