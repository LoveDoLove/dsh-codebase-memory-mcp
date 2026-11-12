# AGENTS.md

Working notes for agents and humans who change this repository.

This file is an index, not a manual. Each topic lives in its own document under `docs/`. Read the one that matches the work in front of you.

## What this repository is

`@lovedolove/dsh-codebase-memory-mcp` is a DeepSeek Harness plugin. It connects a DSH profile to the external `codebase-memory-mcp` binary, keeps that daemon running, starts its graph UI on port 9749, and registers six `cbm_*` tools that answer structural questions about a codebase.

It does not parse code. All parsing and indexing happens in the binary. This package is the bridge.

## Start here

| You are about to | Read |
| --- | --- |
| Install or run it | [docs/install.md](docs/install.md) |
| Change a config field or an env var | [docs/configure.md](docs/configure.md) |
| Add, rename, or fix a tool | [docs/tools.md](docs/tools.md) |
| Touch the client, engine, or discovery layer | [docs/architecture.md](docs/architecture.md) |
| Change an export or a public class | [docs/library-api.md](docs/library-api.md) |
| Debug something that does not work | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Understand why the design is like this | [WHITEPAPER.md](WHITEPAPER.md) |

## The rules that bite

These are the constraints a change has to respect. They are listed here because breaking one causes a failure that is hard to trace, not because they are interesting.

**Never write to stdout at startup.** The agent protocol frames JSON-RPC on stdout. A `console.log` corrupts the stream. Startup notices go to stderr through `announce` in `src/client.mjs`. Everything else goes through `ctx.logger`.

**`ctx.logger` is invisible on `dsh web`.** The harness logger on a real boot has no console exporter. It writes to an in-memory ring buffer. A message logged there reaches the log view and never reaches the terminal, so a user cannot see it. If a human must see the text, use stderr.

**Keep the daemon start inside `cbmApply`.** Version 0.1.5 replaced the `cbmApply` call with `getOrCreateCodeClient`, which constructs a client and never calls `start()`. The daemon silently stopped starting and the bug survived four releases. A test in `test/apply-autostart.test.mjs` now pins it.

**Never fail plugin load.** `tools` is the only hard dependency (`inject: ['tools']`). `systemPrompt`, `skills`, and `commands` are injected through `injectCapability` in `src/index.mjs`, which warns and continues. A missing optional peer disables a feature. It never blocks startup.

**Do not swallow errors.** Four registration paths once ended in a bare `catch {}`, which made a broken registration indistinguishable from a capability that was never offered. Warn through `log.warn` instead.

**Thread `exec.signal`.** A cancelled tool call must return promptly. The pipeline waits for quiescence before marking the outcome `ABORTED`, so a call that ignores the signal pins open for the full 60 second rpc timeout. Cancellation errors must have `err.name = 'AbortError'`, because the pipeline classifies by name.

**Guard the repository boundary.** `resolveSafeRepoPath` in `src/discovery.mjs` rejects any path that escapes the repository root. A tool that reads a file must go through it.

## Layout

```
src/index.mjs     plugin entry, Config, apply, capability registration
src/client.mjs    process lifecycle, JSON-RPC 2.0 over stdio, degraded adapter
src/engine.mjs    argument translation, boundary checks, result shapes
src/tools.mjs     the six tool definitions and their renderers
src/discovery.mjs file walking, gitignore matching, project slugs, path guards
src/skills.mjs    the bundled agent skill
src/watcher.mjs   RepositoryWatcher, exported but not wired into the default path
src/bridge.mjs    compatibility layer for the pre-0.1.5 exports
src/redact.mjs    secret scrubbing
src/types.mjs     frozen constants, including DEFAULT_UI_PORT
skills/           the bundled skill markdown
test/             44 tests, node --test
docs/             the document set indexed above
```

## Commands

```sh
npm ci               # install dev dependencies
npm test             # node --test test/*.test.mjs
npm run pack:check   # npm pack --dry-run
```

Run `npm test` before you commit. The suite boots a fake MCP server in two tests, so a broken handshake shows up there.

Probes and one-off scripts must run inside this directory. A script copied to `/tmp` cannot resolve `node_modules` and fails with `ERR_MODULE_NOT_FOUND`.

## Daemon hygiene

The graph UI binds port 9749. A stale daemon from an earlier run holds the port and makes a fresh start look broken.

List before you kill:

```sh
pgrep -af "codebase-memory-mcp" | grep -v pgrep
```

Then kill a specific pid. Never run `pkill -f "codebase-memory-mcp"`. The pattern matches the shell that wraps the command and kills it too.

Check the port directly:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9749/
```

`200` means the UI is up. `000` means nothing is listening.

## Releasing

`publish-npm.yml` runs on every push to `main`. It runs `npm ci`, `npm test`, then `npm stage publish --access public`, which stages the package and does not publish it. A human approves the staged version in an authenticated npm session.

Release notes are extracted from `CHANGELOG.md` by a workflow step that matches `^## \[<version>\]`. Keep the changelog format.

`[skip publish]` in a commit message skips the publish job.

## Writing style for this repository

Documentation follows a few plain rules. They are not preferences.

- One document, one mode. A how-to has steps, a reference has facts, an explanation has reasoning. Do not mix them, link instead.
- Use the real name every time. `cbm_search`, `CBM_EXE`, `src/tools.mjs`. Never a synonym or a description.
- Sentence-case headings. One h1 per page. No skipped levels.
- No em dashes. No colon as a mid-sentence connector. Straight quotes.
- Say "is", not "serves as". Prefer the plain word.
- Name the version, the flag, or the file when you make a claim. If you did not measure it, say so.

## Reporting a problem

Include the output of the four commands in [docs/troubleshooting.md](docs/troubleshooting.md#collecting-evidence-before-you-file-an-issue), the DSH version from `dsh --version`, the plugin version from `npm ls @lovedolove/dsh-codebase-memory-mcp`, and whether the same operation works through the binary's own CLI.
