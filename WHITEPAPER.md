# Codebase Memory for DeepSeek Harness

## A whitepaper on structural code intelligence for coding agents

Version 0.1.10 · November 2026 · MIT licensed

---

## Abstract

Coding agents read code as text. They open files, search strings, and reconstruct structure in context. That works for small repositories and degrades quickly as a codebase grows, because the structure an agent needs is already known to the compiler and thrown away before the agent sees it.

This document describes a plugin that gives a DeepSeek Harness agent a persistent code graph. The graph is built once per repository, stored on disk, and queried through six tools that answer structural questions directly. The plugin is small. Its design choices are the interesting part, and this document argues for each one with the constraint that produced it.

---

## 1. The problem

### 1.1 Text search answers the wrong question

An agent that needs to change `Object.handler` must first find every place that depends on it. With a text search it gets a list of files containing the string `handler`. Most of those matches are unrelated. A few are real callers. Nothing in the result tells the agent which is which.

The agent then reads files to find out. Each read costs context. The reads are repeated on the next task, because the agent forgot what it learned. A twenty minute session can spend most of its budget rebuilding a picture of the code that never changes.

### 1.2 The information already exists

A parser can answer all of this. Which symbol is at a location. Which symbols a file defines. Which symbol calls which. Which file imports which. Compilers and language servers compute these relations routinely and discard them when the process exits.

The graph just needs to outlive the process that built it.

### 1.3 Three requirements follow

If the premise is that the graph should outlive the request, three requirements follow immediately.

The graph must be **persistent**. Rebuilding it on every question defeats the purpose.

Queries must be **cheap**. A tool call that costs more than the greps it replaces will not be used.

The failure mode must be **soft**. A coding assistant that refuses to start because a graph backend is unavailable is worse than one that falls back to greps.

Everything below is a consequence of these three.

---

## 2. Design

### 2.1 Where the boundary sits

The plugin does not parse code. Parsing is a large, language-specific, ever-moving problem, and a separate project already solves it. `codebase-memory-mcp` is an external binary that builds the graph, persists it, and serves queries. The plugin's job is to connect that binary to a harness without leaking the binary's complexity into the harness.

```
DSH agent
   │
   ▼
cbm_* tool (schema, argument names, output rendering)
   │
   ▼
engine (argument translation, boundary checks, degraded shapes)
   │
   ▼
client (process lifecycle, JSON-RPC 2.0 over stdio)
   │
   ▼
codebase-memory-mcp binary ──▶ on-disk graph index
   │
   ▼
http://localhost:9749/ ──▶ graph UI in a browser
```

This boundary carries a cost. A user must install a second program. The plugin cannot work without it. Section 5 argues that the cost is worth paying and describes what was rejected instead.

### 2.2 Why stdio and not HTTP

The plugin speaks JSON-RPC 2.0 to the binary over its stdin and stdout, not over a network socket.

A socket needs a port, a way to agree on it, a way to know whether the process on the other end is the one you started, and an authentication story for the local case. Every one of those is a failure mode a user can hit.

A pipe needs none of them. The child process is the endpoint. If the pipe is open, the peer is alive and is the process this plugin spawned. When the parent exits, the pipe closes and the daemon goes with it, so there is no orphan to clean up.

The cost is that a crashed child takes the transport with it. The client handles that by rejecting every pending request with a single error, resetting the child reference, and letting the next tool call start a fresh process. A caller sees a failed request, not a hung one.

### 2.3 Why the engine sits between tool and client

The tool layer and the client layer could talk directly. A translation layer sits between them for three reasons, and each one is a defect that existed before it did.

**Argument names differ.** The harness exposes `name_pattern`, `file_path_pattern`, and `qualified_name`. The upstream binary expects `name_pattern`, `file_pattern`, and `qualified_name` for some calls and `pattern` for others. Translating in one place means the tool schema can stay stable while the upstream evolves. The engine also accepts the alternate spellings callers already use, so `symbol` and `function_name` both work on `traceCallPath`.

**Defaults differ.** A trace with no depth means depth 3 to this plugin and something else upstream. Putting the default in the engine makes it one number in one file.

**Failures differ.** The client throws. The tool layer must not, because a thrown error inside a tool registration becomes an opaque pipeline failure. The engine converts a transport error into a result object with `ok: false` and a `message`, which the tool renders as text the model can read and act on.

### 2.4 Why degraded mode is the default

The plugin declares exactly one hard dependency, `tools`. Everything else is injected softly, and every capability has a path that works without it.

When the binary is missing, three things happen in order. The plugin loads and registers its six tools. Each call returns `{ ok: false, degraded: true, message }`. The tool renders that as `Code Intelligence Degraded: <message>`.

The alternative was to refuse plugin load. That is worse for a reason that is easy to miss. A harness profile holds many plugins. A plugin that fails to load can take the profile down with it, which turns "the graph is unavailable" into "the harness will not start". A coding assistant that cannot start because a graph backend is missing has failed at its main job.

The cost of this choice is honest. An agent can call `cbm_trace`, receive a degraded message, and then have no graph. It must fall back to greps itself. The plugin makes the fallback visible rather than automatic, because a silent fallback would let the agent believe it had structural information when it did not.

### 2.5 The two boundaries that are not about performance

Two checks exist for safety, not speed, and both run on the plugin side because the plugin is the only place that knows what the harness considers in bounds.

**The repository boundary.** `cbm_snippet` accepts an optional `file_path`. A model can generate any path, including `../../etc/passwd` or an absolute path outside the workspace. `resolveSafeRepoPath` resolves the candidate against the repository root, rejects anything that escapes it, and returns `File path outside repository boundary`. The check runs before the request reaches the binary, so a malformed path never becomes a read.

**Secret scrubbing.** Code snippets and text search results can contain credentials that happen to live in a source file. `scrub` in `src/redact.mjs` removes values matching known secret shapes, and `sanitizeCodeContent` applies it to snippet and search output. This reduces accidental disclosure. It does not guarantee that no secret ever passes through, and the documentation says so rather than implying otherwise, because a scrubbing guarantee that is trusted but incomplete is worse than a documented heuristic.

### 2.6 Index lifecycle

An index moves through a fixed set of states, defined once in `src/types.mjs` and never redefined elsewhere.

| State | Meaning |
| --- | --- |
| `NOT_INDEXED` | No index exists for this project |
| `INDEXING` | A first index is being built |
| `READY` | The index exists and matches the working tree |
| `UPDATING` | The index exists and is being rebuilt |
| `DEGRADED` | The binary is unreachable, so no state can be confirmed |
| `ERROR` | The last attempt failed |

Two details matter. A re-index of an already indexed project moves `READY` to `UPDATING` rather than back to `INDEXING`, so a reader can tell the difference between a first build and a refresh. And concurrent index requests for the same repository share one promise through an `activeOperations` map, so a second call joins the first rather than starting a competing build.

The state is persisted to `$DSH_HOME/codebase-memory/projects/<projectId>/code_index.json` on every exit path, including failure. A crashed build therefore leaves a record that it was attempted.

### 2.7 Why registration is soft everywhere except tools

Cordis injects dependencies by name. `inject: ['tools']` is hard, which means the plugin does not apply until a tools service exists. That is correct, because a plugin whose entire purpose is registering tools has nothing to do without one.

The other three, `systemPrompt`, `skills`, and `commands`, are injected through a small helper that guards the call and logs a warning when the capability is absent. A profile with no skill service therefore loses the bundled skill and keeps the tools. The warning names what was lost, so the absence is diagnosable rather than mysterious.

Before this was the behaviour, four registration paths ended in a bare `catch {}`. A broken registration produced silence. Silence is the worst outcome in a plugin, because it looks identical to a capability that was never offered.

### 2.8 Cancellation

A tool call that has been cancelled must return promptly. The harness pipeline does not abandon a started promise. It waits for quiescence and then marks the outcome as `ABORTED`. A plugin that ignores the abort signal therefore pins a cancelled call open until its own timeout expires, which in this plugin is 60 seconds of rpc timeout.

The signal is threaded from the tool call through the engine into the client, where it is registered on the socket request and removed on every settle path. Errors created for a cancellation carry `name = 'AbortError'`, because the pipeline classifies by name and not by message.

---

## 3. What the tools answer

Six tools cover the questions that come up repeatedly. Each one exists because a specific question was expensive without it.

| Tool | Question | Why not greps |
| --- | --- | --- |
| `cbm_projects` | What is indexed and how fresh | No text equivalent |
| `cbm_search` | Which symbols match this pattern | Returns definitions, not string hits |
| `cbm_trace` | Who calls this, and what it calls | The answer is a graph walk, not a match |
| `cbm_snippet` | The source of exactly this symbol | Needs the symbol boundary, not line offsets |
| `cbm_arch` | How a directory is put together | Aggregate view over many files |
| `cbm_search_code` | Where is this literal, error, or key | The one case greps handle well |

The last row is the honest one. Text search remains the right tool for literals, error strings, and configuration keys. The plugin provides `cbm_search_code` for that case and the bundled skill says plainly when to prefer `grep`. A tool that claims to replace text search would be worse than one that says where text search still wins.

---

## 4. Evidence

Claims in this document are labelled. Measured means it was run on this machine. Inferred means it follows from a design, not from a test. Guess means neither.

**The daemon starts with the harness. Measured.** A clean boot of `dsh web` on version 0.1.9 prints the stderr banner, and `curl` on port 9749 returns `200` after boot. Before the fix described in section 4.1, the same boot printed nothing.

**A missing binary does not block startup. Measured.** With `CBM_EXE` pointed at a nonexistent path, the plugin loads, registers six tools, and each call returns a degraded result. The suite asserts this in `test/client.test.mjs`.

**Cancellation returns before the timeout. Measured.** The cancellation test fails by hanging for the full 60 second rpc timeout when the abort listener is removed, and passes in under a second when present.

**The repository boundary rejects escapes. Measured.** `test/engine.test.mjs` asserts that `getCodeSnippet` targeting a path outside the repository returns a rejection rather than a read.

**The index matches the repository. Measured.** Indexing this repository produced 287 nodes and 768 edges with `parse_unusable_count: 0` and `skipped_count: 0`.

### 4.1 A regression worth recording

Version 0.1.5 refactored the plugin into a standalone package. The refactor replaced a call to `cbmApply`, which starts the daemon, with a call to `getOrCreateCodeClient`, which only constructs a client. Nothing called `start()`. The daemon stopped starting, and the plugin still loaded, still registered tools, and still returned valid degraded results.

The bug survived four releases. It was invisible precisely because the failure mode was soft. That is the cost of section 2.4 and it should be recorded next to the benefit.

The fix restored the call and added two things the bug exposed as missing. First, a startup notice on stderr, because a user cannot distinguish a silent success from a silent failure. Second, a test that asserts the notice reaches the terminal, so a future refactor that drops the start fails in CI rather than in a user's session.

### 4.2 Why the notice goes to stderr

The harness logger on a real boot has no console exporter. It writes to an in-memory ring buffer. A plugin that logs its startup through `ctx.logger` prints nothing.

Standard output is also unavailable, because the agent protocol frames JSON-RPC on it. Writing a banner to stdout would corrupt the message stream.

Standard error is the only channel left, and it is the conventional one for process notices. The plugin writes its banner there directly and keeps diagnostic logging on `ctx.logger`, where the harness log view can read it.

---

## 5. Alternatives considered

**Parse in the plugin.** Rejected. It moves a large, language-specific problem into a small plugin, and it duplicates a working external implementation. The plugin would need a parser per language and would fall behind each one.

**Query a language server per repository.** Rejected for the same reason plus a worse one. Language servers are designed for interactive editing and hold warm state in a process. The graph needs to be persisted and shared across sessions, and a language server is the wrong lifetime.

**HTTP transport to the binary.** Rejected. It adds a port, an agreement problem, a liveness check, and a local authentication question, in exchange for nothing the pipe does not already give. See section 2.2.

**Refuse to load without the binary.** Rejected. It converts a missing optional dependency into a harness that will not start. See section 2.4 for the tradeoff and its cost.

**Build the graph automatically on every tool call.** Rejected. It makes the first query cost a full index and makes every query pay a staleness check. Indexing is an explicit act with an explicit command.

**Hide the degraded state.** Rejected. An agent that does not know it lacks a graph will keep asking structural questions and receiving nothing. The degraded string is deliberately loud.

---

## 6. What this does not do

The plugin does not parse code, does not decide what to index, does not watch the filesystem by default, and does not choose which tool an agent calls.

`RepositoryWatcher` exists in the library and is not wired into the plugin's default path, because automatic incremental indexing needs a policy about when a rebuild is worth its cost, and no policy was chosen. The class is exported for callers who have one.

The plugin also does not claim to replace text search. Section 3 says where it wins and where it does not.

---

## 7. Summary of the argument

A coding agent loses time rebuilding a picture of the code that already exists in a form the compiler understands. Persisting that picture and exposing it as six narrow tools removes most of that cost.

Four choices carry the design. Put the parser outside the plugin so each side can move. Use a pipe so lifetimes are tied and there is nothing to authenticate. Keep one translation layer so the tool schema outlives upstream changes. Make every failure except the tools themselves soft, and make each soft failure loud, because a silent degraded path is indistinguishable from a working one and will be trusted until it matters.

The regression in section 4.1 is the proof of that last point, and the reason the startup notice is now a tested behaviour rather than a nicety.

---

## References

- Repository: <https://github.com/LoveDoLove/dsh-codebase-memory-mcp>
- Package: <https://www.npmjs.com/package/@lovedolove/dsh-codebase-memory-mcp>
- Architecture: [docs/architecture.md](docs/architecture.md)
- Configuration: [docs/configure.md](docs/configure.md)
- Library API: [docs/library-api.md](docs/library-api.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
