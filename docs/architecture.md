# How the codebase-memory plugin works

The plugin sits between the DSH agent and the native `codebase-memory-mcp` executable, exposing six Cordis tools that resolve to JSON-RPC calls over a child process, and it keeps working, with visible warnings, when that executable is missing.

## Three layers

`src/index.mjs` is the Cordis entry. It declares the name `codebase-memory`, the hard dependency `inject: ['tools']`, the `Config` schema (`exePath`, `uiEnabled`, `port`, `eagerStart`) and the `apply` hook. It also builds the system prompt guidance text and the `/cbm` command.

`src/engine.mjs` holds `CodeIntelligenceEngine`. It owns per-repository index status, the metadata file, the boundary check and the scrub step. It decides whether a call may proceed and normalizes each answer to a shape such as `{ ok, degraded, message }` plus one payload field.

`src/client.mjs` holds `CodebaseMemoryClient`. It locates the executable, spawns it, frames JSON-RPC, matches replies to requests, respawns lazily on the next call after an exit, and turns failures into degraded results.

`src/tools.mjs` holds the six tool definitions. Each one resolves a working directory, picks a repository root, calls one engine method and renders text through a `render` callback.

The tool names stay stable across all of that. Each one maps to a single engine method, and each engine method maps to one upstream tool name.

| Tool | Engine method | Upstream tool |
| --- | --- | --- |
| `cbm_projects` | `listProjects` | `list_projects` |
| `cbm_search` | `searchSymbols` | `search_graph` |
| `cbm_snippet` | `getCodeSnippet` | `get_code_snippet` |
| `cbm_trace` | `traceCallPath` | `trace_path` |
| `cbm_arch` | `getArchitecture` | `get_architecture` |
| `cbm_search_code` | `searchCodeText` | `search_code` |

Two details in that layer matter for behavior. `resolveWorkspace` (`src/tools.mjs:30`) walks a fixed list of `cwd` candidates in order, starting with `source.session.header.cwd`, and returns `process.cwd()` when none is a non-empty string. A `repo` argument always overrides it. `defineTool` is loaded through `createRequire` with a pass-through fallback, so the definitions still register when `@deepseek-ai/dsh-tools` cannot be required.

```
DSH agent
   |  calls a tool by name
   v
src/tools.mjs          cbm_* definitions, execute and render
   |  CodeIntelligenceEngine
   v
src/engine.mjs         status, metadata, boundary check, scrub
   |  CodebaseMemoryClient
   v
src/client.mjs         spawn, JSON-RPC 2.0, respawn, degraded results
   |  stdin and stdout, one JSON object per line
   v
codebase-memory-mcp    child process, owns the graph index
   |
   v
graph index on disk

browser  -->  http://localhost:9749/  -->  same child process (--ui=true)
```

The browser path is direct. When `uiEnabled` is true the client passes `--ui=true` and `--port=<port>` to the child, and the executable serves its own graph UI. The plugin never proxies HTTP. It only advertises the URL in `guidanceText` and in the `/cbm` command output. If you set `uiEnabled` to false the client passes `--ui=false` instead, and nothing listens on that port.

## Why JSON-RPC over stdio

The upstream project is an MCP server, so the plugin speaks the protocol the binary already implements rather than reimplementing graph queries in JavaScript. That keeps the AST work in the native process and leaves this package with transport and policy.

`ensureStarted` (`src/client.mjs:101`) runs these steps in order.

1. Throw when the client is disposed.
2. Throw when `isAvailable` is false, which means `exePath` is unset or the file is gone.
3. Return when a child exists, is not killed and reports `exitCode === null`.
4. Return the existing `startPromise` when a start is already in flight, so concurrent calls share one spawn.

The spawn itself uses `stdio: ['pipe', 'pipe', 'pipe']` and `windowsHide: true`. Then comes the MCP handshake. The client writes one line holding `{"jsonrpc":"2.0","id":<n>,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"codebase-memory","version":"0.1.0"}}}` and waits for the reply on a dedicated 30 second timer. When the reply carries `serverInfo` the client stores it. The next line is a notification with no `id`, `{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`. Only after that does `ensureStarted` resolve.

`rpc` (`src/client.mjs:228`) is the general path. It rejects early on an aborted signal, awaits `ensureStarted`, takes the next integer id, and writes `{"jsonrpc":"2.0","id":<n>,"method":<method>,"params":<params>}` plus a newline to stdin. The default timeout is 60 seconds (`timeoutMs = 60_000`), and `callTool` passes `60_000` explicitly. Every settle path runs the same `finish` helper, which clears the timer, deletes the pending entry and removes the abort listener.

Responses arrive on stdout. `flushBuffer` splits on newlines, parses each line, looks up `msg.id` in the pending map and rejects when `msg.error` is present, using `msg.error.message`. Malformed lines are discarded without a word. If the child exits, the `close` handler rejects everything still pending with `codebase-memory-mcp process closed (code: <code>)` and clears both `child` and `startPromise`, which is what allows a later call to spawn again.

Cancellation gets its own error type. `abortError` (`src/client.mjs:24`) sets `err.name = 'AbortError'`, and `callTool` rethrows that name instead of converting it into a degraded result, because the tool pipeline records a call as ABORTED by checking the name rather than the message. Every other failure becomes the degraded shape described next.

## Degraded mode

Availability is a file check, not a handshake. `isAvailable` on the client is `Boolean(this.exePath && existsSync(this.exePath))`, and `isDegraded` on the engine is exactly `!this.client.isAvailable`.

Nothing in `apply` consults that value before registering tools. `registerCbmTools` registers all six regardless, and each call then takes one of two short paths.

- The engine methods return `{ ok: false, degraded: true, message: 'Code intelligence degraded' }` before touching the client.
- `callTool` returns `{ isError: true, degraded: true, content: [{ type: 'text', text: ... }] }` when the binary is missing, with an install hint and the `CBM_EXE` variable name.

The tool `render` callbacks check `value?.degraded` first and print `Code Intelligence Degraded: <message>` instead of an empty list. Missing binary, spawn failure and RPC failure therefore share one visible outcome.

The tradeoff is deliberate. Failing plugin load would remove `cbm_*` from the tool catalog and take the guidance section and the skill with it, so an agent would have no way to tell an absent tool from an unused one, and no route to fix the install. Loading anyway keeps the instructions, the `/cbm` diagnostics and the install text in front of the model.

The cost is real. A degraded call returns a well formed result with `ok: false`, and a renderer that ignores the flag shows the same empty text as a healthy query with no matches. The model can read "No matching symbols found." as evidence about the code. The startup notice goes to stderr and to the logger, so it stays invisible in a log stream.

There is a second edge. `exePath` is resolved once in the constructor by `findCodebaseMemoryExe`. If the path existed and later vanished, `isAvailable` flips to false on the next check. If it was null at construction, it stays null until the client is rebuilt, which happens in `getOrCreateCodeClient` only when the shared client is disposed.

## The two clean boundaries

Two different checks guard two different things. Neither one is a sandbox.

`resolveSafeRepoPath` (`src/discovery.mjs:151`) answers "is this path inside this repository root". It resolves the root and the target, computes `relative(absRoot, absTarget)` and returns null when the result starts with `..` or is absolute. It returns `.` when the target is the root itself, then applies an `existsSync` plus `realpathSync` comparison so a symlink that points outside the root is also rejected. Any error in that resolution fails closed with null, and the success value is the relative path with platform separators replaced by forward slashes.

It runs in three places. `engine.getCodeSnippet` (`src/engine.mjs:263`) checks an optional `file_path` before calling the client and returns `File path outside repository boundary` when the check fails. `discoverRepository` checks every entry before descending or collecting. `RepositoryWatcher.handleRawFsEvent` checks each event path. What it protects is path traversal inside a root you already chose. It does not choose the root. The `cbm_*` tools accept a `repo` argument and pass it to the engine as `targetRepo`, so the boundary is the caller's root, not a fixed one.

`scrub` (`src/redact.mjs:39`) answers "does this text look like a credential". It runs five regular expressions in a fixed order: bearer tokens and JWTs, quoted assignments to `api_key`, `secret`, `password`, `token`, `private_key` and similar names, prefixed tokens such as `ghp_`, `github_pat_`, `sk-` and `AKIA`, PEM private key blocks, and `UPPER_CASE` environment assignments of eight characters or more. It returns `{ clean, scrubbed, redactionsCount, detectedPatterns }`.

The engine calls it through `sanitizeCodeContent` in exactly two methods. `getCodeSnippet` scrubs the snippet text before returning it, and `searchCodeText` scrubs the code search output. `searchSymbols`, `traceCallPath`, `getArchitecture`, `listProjects` and `detectChanges` return the child process text unchanged. Scrubbing also does not inspect the arguments going the other way, so a secret you paste into a query reaches the daemon as typed.

Do not read the scrubber as a guarantee. It matches shapes, not entropy. A bare hex token with no label, a key split across two lines, a credential inside a comment with unusual punctuation, or a base64 blob above eight characters under a name outside the list all pass through. `redactionsCount` counts patterns that changed the text, not individual matches, so one replaced pattern and forty replaced tokens both report 1.

## Index lifecycle

The six states live in `INDEX_STATUS` (`src/types.mjs:5`), which is frozen: `not_indexed`, `indexing`, `ready`, `updating`, `degraded`, `error`.

`getStatus` (`src/engine.mjs:78`) resolves in three steps. An in-memory entry in `this.statuses` wins. Otherwise the persisted file is loaded through `loadMetadata` and cached. Otherwise you get a fresh object, `degraded` when the binary is unavailable, or `not_indexed` when it is available.

`indexRepository` (`src/engine.mjs:109`) then moves through these transitions.

1. Read the current status.
2. Choose `updating` when the current state is `ready`, and `indexing` otherwise.
3. Return a `degraded` object without calling the client when the engine is degraded.
4. Call `discoverRepository` for a file count, then `client.indexRepository(repoRoot, projectName, mode)` with `mode` defaulting to `fast`.
5. On `res.isError`, write `error` with the `degraded` flag copied from the result.
6. On success, write `ready` with `lastIndexedAt` set to `new Date().toISOString()` and `filesCount` from the discovery scan.
7. On a thrown exception, write `error` with the exception message.

Every terminal write also calls `saveMetadata` with a JSON body at `getMetadataPath(repoRoot)`, which is `$DSH_HOME/codebase-memory/projects/<projectId>/code_index.json` when `DSH_HOME` is set and `~/.dsh/codebase-memory/projects/<projectId>/code_index.json` otherwise. The project id comes from `cbmProjectName`, which turns a POSIX path like `/home/user/repo` into `home-user-repo` and a Windows path like `C:\path\to\repo` into `C-path-to-repo`. Persistence failures are swallowed, so a read only home directory leaves the in-memory state correct and the file stale.

`filesCount` is the number of files this package could see, not the number of files the daemon actually parsed. Treat it as a scan size.

Concurrent calls for one root share a single run. `activeOperations` is a `Map` from repo root to promise, and a call that finds an entry returns it rather than starting a second index pass. The `finally` block deletes the entry when the operation reaches a terminal state. Note that the degraded branch returns before that `try` block, so a root that first indexes while degraded keeps its resolved promise in the map, and later calls for that root return the old degraded object instead of retrying.

## Registration and graceful capability injection

`inject: ['tools']` is the one hard dependency. Cordis will not call `apply` until the tools service exists, and the plugin cannot function without it, since every user visible action is a tool.

The other three capabilities are soft. `injectCapability` (`src/index.mjs:190`) is a small wrapper that returns silently when `ctx.inject` is not a function, calls `ctx.inject(deps, callback)` inside a `try`, and logs a warning when that call throws synchronously. `apply` uses it three times.

- `systemPrompt` runs `registerSystemPromptGuidance`, which adds a section named `codebase-memory:guidance` at order 3040 and returns false when `scope.systemPrompt.section` is not a function.
- `skills` runs `registerSkills`, which prefers `registerProvider` at rank 600 with source `bundled` and falls back to `register` with the body already loaded. It returns an empty array when the service exposes neither.
- `commands` runs `registerSlashCommands`, which registers `/cbm` and returns false when `scope.commands.register` is not a function.

Disposal behavior differs by capability. The guidance section and the `/cbm` command both register inside `scope.effect`, so they are removed when the scope disposes. The skills provider is registered with a direct `skills.registerProvider` call and has no effect wrapper, so it outlives that teardown. A missing capability means the callback never runs, which is why an absent skills service is not an error. The plugin still registers its tools and still answers calls. `package.json` marks the matching peer packages optional, so an install without `@deepseek-ai/dsh-skill` resolves, and only the skill entry point is lost.

Partial failure is contained per capability. If `systemPrompt.section` throws inside `registerSystemPromptGuidance`, the helper logs and returns false, and the skills and commands callbacks still run.

## Startup and shutdown

`apply` calls `cbmApply` (`src/client.mjs:465`) first. That function gets the shared client, registers the dispose effect with `ctx.effect?.(() => () => { client.dispose?.() ... })`, then decides whether to start.

`Config.eagerStart` defaults to true. `cbmApply` computes `shouldStart` as `opts.eagerStart !== undefined ? Boolean(opts.eagerStart) : !isTest`. The test guard covers `NODE_ENV=test`, `--test` in `execArgv` or `argv`, and any argument ending in `.test.mjs` or `.test.js`. It only fires when `eagerStart` is absent from the config, and with the schema default present it does not fire, so a default configuration starts the daemon under the test runner too.

`autoStartCodebaseMemory` (`src/client.mjs:423`) owns the availability decision. It returns null when there is no client, returns null after announcing `codebase-memory-mcp executable not found` on stderr when the binary is missing, and returns null when the child is already running. Otherwise it starts the process, then announces the UI URL or logs the start failure. The stderr write is deliberate, because a Cordis logger on a `dsh web` boot may have no console exporter and stdout is the protocol stream in some profiles.

Restart is reactive, not supervised. The `close` handler rejects pending calls and clears `child` and `startPromise`, so the next `rpc` call walks into `ensureStarted` and spawns a fresh process. There is no retry budget and no backoff, so a binary that crashes during the handshake is respawned once per failing call, and each attempt costs one spawn plus a 30 second initialize window at worst.

Shutdown reaches the same `stop()` from three places. Plugin disposal runs the `ctx.effect` callback, which calls `client.dispose()`. `resetSharedCodeClient` stops and drops the module level singleton. `CodeIntelligenceEngine.dispose` calls `this.client.dispose?.() || this.client.stop?.()`. In every case `stop()` sets `isDisposed`, sends `SIGTERM` and rejects pending calls. After that, `ensureStarted` throws `CodebaseMemoryClient is disposed` rather than spawning again.

Two pieces ship but do not start with the plugin. `src/watcher.mjs` exports `RepositoryWatcher`, a debounced `fs.watch` wrapper that re-indexes through `engine.indexRepository` when files change, and `apply` never constructs one. `src/engine.mjs` likewise exports `getOrCreateCodeEngine`, while the tools build their engine from the client passed by `registerCbmTools`. Both are available to consumers of the package, not active in the default plugin wiring.
