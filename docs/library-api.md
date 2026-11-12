# Library API reference

`@lovedolove/dsh-codebase-memory-mcp` is a plain ESM package. The same modules that power the DSH plugin work outside DSH, so you can import the client, engine, discovery helpers, and tool definitions in any Node 18 or newer process. Nothing in the library requires a Cordis context. Only `apply` and `registerCbmTools` touch plugin services.

The package declares its entry points in `package.json` (lines 7 to 17). Use the subpath that matches the layer you need.

## Subpath exports

| Subpath | Entry file | What it gives you |
| --- | --- | --- |
| `.` | `./src/index.mjs` | Plugin entry plus every re-export from types, redact, discovery, client, engine, watcher, and tools |
| `./bridge` | `./src/bridge.mjs` | Legacy compatibility layer with the older names and an `EXE` constant resolved at import time |
| `./client` | `./src/client.mjs` | `CodebaseMemoryClient`, executable discovery, the shared client, and the auto-start helper |
| `./discovery` | `./src/discovery.mjs` | Repository walking, path boundary checks, secret and binary filters, gitignore matching, project naming |
| `./engine` | `./src/engine.mjs` | `CodeIntelligenceEngine` with index status tracking and sanitized query results |
| `./tools` | `./src/tools.mjs` | The six `cbm_*` tool definitions and their registration helper |
| `./types` | `./src/types.mjs` | Frozen enum objects and `DEFAULT_UI_PORT` |
| `./watcher` | `./src/watcher.mjs` | `RepositoryWatcher` and `closeAllWatchers` |
| `./package.json` | `./package.json` | Package metadata for tooling that reads exports maps |

The `.` entry re-exports the other modules wholesale (`src/index.mjs:18-24`), so root imports and subpath imports reach the same class instances.

## Plugin entry

`src/index.mjs:199` exports the default object as `{ name, inject, Config, apply }`.

| Export | Signature | Role |
| --- | --- | --- |
| `name` | `const name = 'codebase-memory'` | Plugin identifier |
| `inject` | `const inject = ['tools']` | Required Cordis service |
| `Config` | `Schema.object({ exePath, uiEnabled, port, eagerStart })` | Configuration schema |
| `guidanceText` | `(port = DEFAULT_UI_PORT) => string` | Builds the system prompt policy text |
| `GUIDANCE_TEXT` | `const GUIDANCE_TEXT = guidanceText()` | Policy text for the default port |
| `registerSystemPromptGuidance` | `(scope, log, port = DEFAULT_UI_PORT) => boolean` | Adds the guidance section |
| `registerSlashCommands` | `(scope, log, port = DEFAULT_UI_PORT) => boolean` | Adds the `cbm` command |
| `apply` | `(ctx, config = {}) => void` | Cordis apply hook. Wires the client, tools, and optional capabilities |

`Config` declares four fields (`src/index.mjs:43-48`). `exePath` is a string with no default. `uiEnabled` defaults to `true`. `port` defaults to `DEFAULT_UI_PORT`. `eagerStart` defaults to `true`.

`apply` resolves the client through `cbmApply`, registers the tool set, then injects three optional capabilities (`src/index.mjs:157-188`). Each capability goes through `ctx.inject`. A registration failure logs a warning through `log.warn` and returns, so a missing optional peer disables one feature without blocking plugin load.

`registerSystemPromptGuidance` returns `false` when the scope has no callable `systemPrompt.section`. Otherwise it registers a section named `codebase-memory:guidance` at order `3040` and returns `true` (`src/index.mjs:79-96`). `registerSlashCommands` returns `false` when the scope has no callable `commands.register`, otherwise it registers a command named `cbm` and returns `true` (`src/index.mjs:98-150`).

## CodeIntelligenceEngine

`src/engine.mjs:19` defines the class. The constructor takes one options object.

```js
new CodeIntelligenceEngine({ client, config, env })
```

`client` defaults to `getOrCreateCodeClient(opts)`. `config` defaults to `opts` itself. `env` defaults to `process.env`. The engine keeps two maps, `statuses` keyed by repository root and `activeOperations` keyed by repository root.

`isDegraded` (`src/engine.mjs:28`) returns `!this.client.isAvailable`.

| Method | Signature | Behavior |
| --- | --- | --- |
| `indexRepository` | `(repoRoot, opts = {}) => Promise<object>` | Runs or joins an in-flight index operation. Reads `opts.project` and `opts.mode`, default mode `fast` |
| `indexIncremental` | `(repoRoot, opts = {}) => Promise<object>` | Calls `indexRepository` with `mode: 'fast'` forced |
| `searchSymbols` | `(repoRoot, params = {}, signal) => Promise<object>` | Builds `name_pattern`, `file_pattern`, `label`, `limit` from params. Limit defaults to `50` |
| `searchGraph` | `(repoRoot, params = {}, signal) => Promise<object>` | Alias for `searchSymbols` |
| `traceCallPath` | `(repoRoot, params = {}, signal) => Promise<object>` | Accepts `function_name` or `symbol`. `direction` defaults to `both`, `depth` comes from `depth`, `max_depth`, or `maxDepth` and defaults to `3` |
| `getCodeSnippet` | `(repoRoot, params = {}, signal) => Promise<object>` | Accepts `qualified_name`, `qualifiedName`, or `symbol`. Passes `start_line` and `max_lines` when present |
| `getArchitecture` | `(repoRoot, params = {}, signal) => Promise<object>` | Accepts `path` or `directory`. `depth` defaults to `2` |
| `searchCodeText` | `(repoRoot, params = {}, signal) => Promise<object>` | Accepts `pattern` or `query`, plus `file_pattern` and `limit` |
| `listProjects` | `(signal) => Promise<object>` | Returns `{ ok, raw }` from the upstream `list_projects` call |
| `detectChanges` | `(repoRoot) => Promise<object>` | Compares the working tree against the index for the derived project name |
| `dispose` | `() => void` | Calls `client.dispose()`, falling back to `client.stop()` |

Every query method returns an object shaped `{ ok, degraded, ... }` and short-circuits with `ok: false` and `degraded: true` when the engine is degraded. On upstream error the result carries `ok: false` and the first text block from the failure.

`indexRepository` writes a status object to disk on every path (`src/engine.mjs:109-183`). It sets `INDEXING` for a fresh repository and `UPDATING` when the prior status was `READY`. Concurrent calls for the same root share one promise. The metadata file lives at `<home>/projects/<projectId>/code_index.json`, where `<home>` comes from `config.home`, then `env.DSH_HOME`, then `~/.dsh`. You can override the whole path with `config.getMetadataPath` and the project slug with `config.projectIdFor`.

`getCodeSnippet` validates any supplied `file_path` or `filePath` through `resolveSafeRepoPath` and returns `{ ok: false, message: 'File path outside repository boundary' }` when the path escapes the root (`src/engine.mjs:263-269`). Snippet output and text search output pass through `sanitizeCodeContent`.

The class has no `indexStatus` or `checkIndexCoverage` method. Reach those upstream calls through `CodebaseMemoryClient`, or read index state with `getStatus`.

Three additional methods support metadata. `getMetadataPath(repoRoot)` resolves the file path, `loadMetadata(repoRoot)` parses it or returns `null`, and `saveMetadata(repoRoot, data)` writes it and swallows filesystem errors.

## CodebaseMemoryClient

`src/client.mjs:82` defines the class. The constructor takes one options object.

```js
new CodebaseMemoryClient({ exePath, uiEnabled, port, logger, env })
```

`exePath` defaults to `findCodebaseMemoryExe(opts.env)`. `uiEnabled` defaults to `true` through `??`. `port` defaults to `DEFAULT_UI_PORT`. `logger` defaults to `console`. `env` is used only for executable discovery and is not stored.

`isAvailable` (`src/client.mjs:97`) returns whether `exePath` is set and exists on disk.

| Method | Signature | Behavior |
| --- | --- | --- |
| `start` | `() => Promise<void>` | Calls `ensureStarted` |
| `ensureStarted` | `() => Promise<void>` | Spawns the daemon, runs the MCP `initialize` handshake with a 30 second timeout, then sends `notifications/initialized` |
| `rpc` | `(method, params = {}, timeoutMs = 60_000, signal = undefined) => Promise<unknown>` | Writes one JSON-RPC line and awaits the matching id. Rejects with an `AbortError` named error on abort |
| `callTool` | `(toolName, args = {}, signal) => Promise<object>` | Calls `tools/call`. Returns a degraded error object when the binary is missing and rethrows aborts |
| `call` | `(name, args = {}, signal) => Promise<string>` | Calls `tools/call` and returns joined text. Throws when the result is marked as an error |
| `indexRepository` | `(repoPath, project, mode = 'fast', signal) => Promise<object>` | Calls `index_repository` and omits `name` when `project` is falsy |
| `searchGraph` | `(args = {}, signal) => Promise<object>` | Calls `search_graph` with args unchanged |
| `tracePath` | `(args = {}, signal) => Promise<object>` | Accepts `function_name` or `symbol`, defaults `direction` to `both` and depth to `3` |
| `getCodeSnippet` | `(args = {}, signal) => Promise<object>` | Accepts `qualified_name`, `qualifiedName`, or `symbol`, plus `start_line` and `max_lines` |
| `getArchitecture` | `(args = {}, signal) => Promise<object>` | Accepts `path` or `directory`, plus `aspects` |
| `searchCode` | `(args = {}, signal) => Promise<object>` | Accepts `pattern` or `query`, plus `file_pattern` and `limit` |
| `listProjects` | `(signal) => Promise<object>` | Calls `list_projects` |
| `indexStatus` | `(project, signal) => Promise<object>` | Calls `index_status` |
| `detectChanges` | `(project, signal) => Promise<object>` | Calls `detect_changes` |
| `checkIndexCoverage` | `(project, signal) => Promise<object>` | Calls `check_index_coverage` |
| `stop` | `() => void` | Marks the client disposed, sends `SIGTERM`, rejects pending calls |
| `dispose` | `() => void` | Calls `stop` and clears the shared singleton when it matches this instance |
| `isRunning` | `() => boolean` | True when the child exists, is not killed, and has no exit code |

The `signal` argument is optional on every async call that accepts it. Pass an `AbortSignal` to cancel. `rpc` checks `signal.aborted` before starting and rejects with an error whose `name` is `AbortError` on abort, which lets callers detect cancellation by name.

`rpc` also takes `timeoutMs`, default `60000`. A timeout rejects with `codebase-memory-mcp rpc timeout: <method>`.

Two module functions wrap the client for plugin use. `autoStartCodebaseMemory(clientOrOpts = getOrCreateClient(), log = console)` starts the daemon and logs the UI URL (`src/client.mjs:423`). `cbmApply(ctx, opts = {})` attaches a dispose effect and starts the daemon unless the process looks like a test run (`src/client.mjs:465`).

## Client factory functions

The module keeps one `sharedClient` binding (`src/client.mjs:400`). It is a module-level singleton, shared by every importer in the process.

| Export | Signature | Behavior |
| --- | --- | --- |
| `getOrCreateCodeClient` | `(opts = {}) => CodebaseMemoryClient` | Creates the singleton on first use and replaces it when disposed |
| `resetSharedCodeClient` | `() => void` | Stops the singleton and sets the binding to `null` |
| `createClient` | `(exePath, opts = {}) => CodebaseMemoryClient` | Always constructs a new client with `exePath` merged over `opts` |
| `findCodebaseMemoryExe` | `(env = process.env) => string \| null` | Resolves the daemon binary |
| `findExe` | `const findExe = findCodebaseMemoryExe` | Legacy alias |
| `getOrCreateClient` | `const getOrCreateClient = getOrCreateCodeClient` | Legacy alias |

`findCodebaseMemoryExe` checks `CBM_EXE`, then `CODEBASE_MEMORY_EXE`, then platform candidates such as `~/.local/bin` on POSIX and the local Programs directory on Windows, then every `PATH` entry (`src/client.mjs:33-80`). Inside WSL it also looks for the `.exe` name on `PATH` when the interop handler is present. It returns `null` when nothing matches.

The engine module mirrors the pattern with `getOrCreateCodeEngine(opts = {})` and `resetSharedCodeEngine()` (`src/engine.mjs:395` and `src/engine.mjs:402`). That singleton is separate from the client singleton.

## Discovery helpers

| Export | Signature | Behavior |
| --- | --- | --- |
| `cbmProjectName` | `(repoPath) => string` | Converts a root path to the upstream slug. POSIX `/home/user/repo` becomes `home-user-repo`. Windows `C:\path` becomes `C-path` |
| `projectNameFromPath` | `const projectNameFromPath = cbmProjectName` | Legacy alias |
| `resolveSafeRepoPath` | `(repoRoot, targetPath) => string \| null` | Returns a POSIX relative path, `'.'` for the root, or `null` when the path escapes the root or a symlink escapes it |
| `isSensitiveOrSecret` | `(relPath) => boolean` | Tests the file name against `SENSITIVE_PATTERNS` |
| `isBinaryFile` | `(absPath, ext = extname(absPath).toLowerCase()) => boolean` | True for a binary extension, or for a null byte in the first 1024 bytes |
| `parseGitignoreContent` | `(content) => Array<{ regex, negated, isDirOnly }>` | Compiles non-comment lines into matchers |
| `matchesGitignore` | `(relPath, rules, isDir = false) => boolean` | Applies rules in order, so a later negation wins |
| `discoverRepository` | `(repoRoot, opts = {}) => Array<{ relPath, absPath, size, mtimeMs, language }>` | Walks the tree with exclusions applied. Throws when the root is missing. `opts.maxFiles` defaults to `50000` |
| `sanitizeCodeContent` | `(content) => string` | Runs `scrub` from `redact.mjs` and returns the scrubbed string, or `''` for non-strings |

`discoverRepository` reads `.gitignore` from the repository root only (`src/discovery.mjs:284-292`). It skips directories in `DEFAULT_EXCLUDED_DIRS`, names matching a sensitive pattern, extensions in `BINARY_EXTENSIONS`, files larger than `MAX_FILE_SIZE_BYTES`, and files that fail the null byte probe. The `language` field comes from `EXTENSION_LANGUAGE_MAP` and falls back to `'unknown'`.

Constant values (`src/discovery.mjs:19-128`):

- `DEFAULT_EXCLUDED_DIRS` is a `Set` of directory names including `.git`, `.hg`, `.svn`, `node_modules`, `vendor`, `dist`, `build`, `out`, `target`, `coverage`, `tmp`, and language caches such as `__pycache__` and `.pytest_cache`.
- `BINARY_EXTENSIONS` is a `Set` of archive, image, media, office, font, and compiled binary extensions. It includes `.svgz` but not `.svg`.
- `SENSITIVE_PATTERNS` is an array of 12 regular expressions covering `.env` files, `.pem`, `.key`, `.p12`, `.pfx`, `.keystore`, `id_rsa`, `id_ed25519`, names containing `credential` or `secret`, `.npmrc`, and `.dockercfg`.
- `EXTENSION_LANGUAGE_MAP` is a plain object mapping extensions to language names, for example `.mjs` to `javascript`, `.ts` to `typescript`, `.rs` to `rust`, and `.go` to `go`.
- `MAX_FILE_SIZE_BYTES` is `2 * 1024 * 1024`, which is `2097152`.

The root entry also re-exports `scrub(content)` and `redact(content)` from `src/redact.mjs`. `scrub` returns `{ clean, scrubbed, redactionsCount, detectedPatterns }` and `redact` returns only the scrubbed string.

## Tool definitions

`createCbmToolDefinitions(runtime = {})` returns six definition objects in this order, `cbm_projects`, `cbm_search`, `cbm_snippet`, `cbm_trace`, `cbm_arch`, `cbm_search_code` (`src/tools.mjs:50-265`). Each definition has `name`, `description`, `parameters`, `output` with a `schema` and `render` function, an `execute` function, and `presentCall`.

The runtime object is interpreted in three ways, in order. A `runtime.codeEngine` value is used directly. A `runtime.client` value is wrapped in a new engine. A runtime that is itself a `CodeIntelligenceEngine` instance is used directly. Anything else is passed to the engine constructor.

`registerCbmTools(ctx, clientOrOpts = {})` returns the array of registered tool names, or `[]` when `ctx.tools.register` is missing (`src/tools.mjs:271-310`). It accepts a client with a `call` method, an object holding `codeEngine` or `client`, or a plain runtime object. Registration goes through `ctx.effect` when that function exists.

`textBlocks(text)` returns `[{ type: 'text', text: String(text ?? '') }]`. `resolveWorkspace(source)` reads candidate `cwd` fields from the execution context in a fixed order, resolves the first non-empty string, and falls back to `process.cwd()`.

Each tool resolves its repository from `args.repo` when present, otherwise from the resolved workspace. The signal travels from the execution context into the engine call.

## Constants

`DEFAULT_UI_PORT` is `9749` (`src/types.mjs:47`). The plugin config, the client default port, and the guidance text all read it.

Frozen enum objects from `src/types.mjs`:

| Export | Members |
| --- | --- |
| `INDEX_STATUS` | `NOT_INDEXED` `not_indexed`, `INDEXING` `indexing`, `READY` `ready`, `UPDATING` `updating`, `DEGRADED` `degraded`, `ERROR` `error` |
| `FRESHNESS_STATUS` | `FRESH` `fresh`, `POTENTIALLY_STALE` `potentially_stale`, `INVALID` `invalid` |
| `CODE_ENTITY_TYPES` | `FILE` `File`, `MODULE` `Module`, `FUNCTION` `Function`, `CLASS` `Class`, `INTERFACE` `Interface`, `METHOD` `Method`, `TYPE` `Type`, `VARIABLE` `Variable` |
| `CODE_RELATIONS` | `DEFINES` `DEFINES`, `CALLS` `CALLS`, `IMPORTS` `IMPORTS`, `REFERENCES` `REFERENCES`, `IMPLEMENTS` `IMPLEMENTS`, `EXTENDS` `EXTENDS`, `DEPENDS_ON` `DEPENDS_ON` |
| `TRACE_DIRECTIONS` | `INBOUND` `inbound`, `OUTBOUND` `outbound`, `BOTH` `both` |

Each object is created with `Object.freeze`, so the maps reject writes at runtime.

## Example

```js
import { CodeIntelligenceEngine } from '@lovedolove/dsh-codebase-memory-mcp/engine'

const engine = new CodeIntelligenceEngine()
const repo = process.cwd()

const status = await engine.getStatus(repo)
console.log('current status', status.status)

const indexed = await engine.indexRepository(repo, { mode: 'fast' })
if (!indexed.ok) console.log('index failed', indexed.message)

const found = await engine.searchSymbols(repo, {
  name_pattern: '.*Engine.*',
  label: 'Class',
  limit: 10,
})
console.log(found.raw)

const trace = await engine.traceCallPath(repo, {
  symbol: 'indexRepository',
  direction: 'inbound',
  depth: 2,
})
console.log(trace.raw)

const snippet = await engine.getCodeSnippet(repo, {
  qualified_name: 'CodeIntelligenceEngine.indexRepository',
})
console.log(snippet.snippet)

engine.dispose()
```

`dispose` releases the process the engine shares with any other holder of the client singleton, so call it last.
