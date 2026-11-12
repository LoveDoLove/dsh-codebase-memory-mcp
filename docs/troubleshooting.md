# Troubleshooting the codebase-memory plugin

Each section below covers one observable symptom, the cause inside this plugin, and the fix that clears it.

## The graph UI is not reachable

A request to `http://localhost:9749/` is refused, and `curl` exits with code 7 or prints `000`. The startup banner about the live UI never appears.

**Cause.** The daemon is not listening on that port. The client passes `--ui=true --port=<port>` only when `uiEnabled` is true. A disabled UI, a missing binary, a failed start, or a port other than 9749 all leave the port closed.

**Fix.**
1. Read the stderr of the process that started DSH.
2. Look for the line `[codebase-memory] 🔍 codebase-memory UI is live: http://localhost:9749/`. Its presence proves the daemon started.
3. If the line is absent, check `uiEnabled` and `port` in the plugin config.
4. Invoke a `cbm_*` tool or run `/cbm` to retry the start.
5. If stderr reports `executable not found`, follow the section below.

## `codebase-memory-mcp executable not found` on startup

Stderr shows this line, with ANSI yellow around the bracketed prefix.

```text
[codebase-memory] codebase-memory-mcp executable not found; the graph UI stays off. Install codebase-memory-mcp or set CBM_EXE.
```

**Cause.** `findCodebaseMemoryExe` returned `null`. It accepts `CBM_EXE` or `CODEBASE_MEMORY_EXE` only when `existsSync` passes. Otherwise it checks `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, the current directory, every `PATH` entry, and the WSL interop name.

**Fix.**
1. Install the binary.

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
```

2. Set `CBM_EXE` to the absolute path of the binary.
3. Confirm the path exists and is executable with `ls -l "$CBM_EXE"`.
4. Restart the DSH process so it inherits the variable.
5. Run `/cbm` to confirm discovery.

## `codebase-memory-mcp failed to start` on startup

The line begins with `[codebase-memory] codebase-memory-mcp failed to start:` and ends with the underlying error message. The banner for the live UI does not follow.

**Cause.** `start()` rejected. The message comes from one of these paths.

- The handshake `initialize` never answered, so the client threw `codebase-memory-mcp initialize timeout (30s)`.
- The child process exited, so the pending call rejected with `codebase-memory-mcp process closed (code: 1)`.
- Spawn failed, so the child error event forwarded a platform message such as `spawn /path EACCES`.
- The daemon refused the UI bind because another process holds the port.

**Fix.**
1. Read the text after the colon. It names the failing stage.
2. Run the binary by hand with the same arguments the client uses.

```bash
codebase-memory-mcp --ui=true --port=9749
```

3. If the hand launch prints an error, fix that error before retrying the plugin.
4. If the launch works, retry the tool once. The client clears `startPromise` after a failure.
5. If the message is a bind error, follow the port section below.

## Tools return `Code Intelligence Degraded`

A `cbm_*` tool prints the prefix, then the engine message. With no binary the full text is `Code Intelligence Degraded: Code intelligence degraded`. After a failed remote call it carries the call error as well.

**Cause.** The engine reports `isDegraded` when `client.isAvailable` is false, which means the executable path did not resolve. A later variant appears when the binary exists but a call fails, and the client then wraps the error as `Code Intelligence degraded: <message>`.

**Fix.**
1. Run `codebase-memory-mcp --version` in the same environment.
2. Search stderr for `[cbm-client] tool <name> failed: <message>`.
3. If the message is `codebase-memory-mcp rpc timeout: <method>`, retry the call.
4. If the message is `codebase-memory-mcp process closed (code: 1)`, start the binary by hand and read its stderr.
5. Set `CBM_EXE` when discovery fails, then restart DSH.

## Tools return `No projects indexed.`

`cbm_projects` prints exactly that sentence.

**Cause.** The daemon returned an empty project list, or its raw text was the same sentence. The common reasons are a fresh daemon with an empty store, a daemon started against a different data directory, or a start that failed before any index existed.

**Fix.**
1. Confirm the daemon is the one you expect with the process check in the last section.
2. Index the repository through the library API or the upstream CLI.
3. Run `cbm_projects(reason="check")` again.
4. If the list stays empty, check the stderr for a failed start or a degraded tool result.

## `No matching symbols found.` when you expect results

`cbm_search` prints that sentence, and no rows appear.

**Cause.** The call succeeded but returned no text. The index is stale, or the query targets another project. Without a `project` argument the engine derives a slug from the session working directory, so `/home/lovedolove/projects/dsh-codebase-memory-mcp` becomes `home-lovedolove-projects-dsh-codebase-memory-mcp`.

**Fix.**
1. Run `cbm_projects(reason="get exact slug")` and copy the name it returns.
2. Pass that value as `project`.
3. Or pass the absolute checkout path as `repo` and let the engine derive the slug.
4. Call `index_status` for the project.
5. Reindex when the status is `not_indexed` or `error`.
6. Widen the pattern, for example `.*login.*`, and retry.

## `File path outside repository boundary`

`cbm_snippet` returns this exact sentence instead of code.

**Cause.** `resolveSafeRepoPath` returned `null` for the `file_path` argument. The path resolved outside the repository root, or it contained `..`, or a symlink realpath escaped the root, or realpath failed on a broken link. The check runs only when `file_path` is supplied.

**Fix.**
1. Pass the repository root in `repo`.
2. Pass `file_path` as a path relative to that root.
3. Replace a symlink that points outside the checkout with a real file.
4. Remove `..` segments from the path.
5. Retry with `qualified_name` alone when you do not need a file hint.

## The daemon holds port 9749 and a second harness cannot start it

A second DSH process prints `codebase-memory-mcp failed to start` and the text names a bind error.

**Cause.** One daemon owns the port. Each client spawns its own child with `--port=9749`, so the second child cannot bind.

**Fix.**
1. Confirm the existing daemon answers.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9749/
```

2. Use the first harness for graph work, because it already owns the daemon.
3. Or set a different `port` in the second profile config.
4. Restart the first harness normally when you need to release the port.
5. Never kill the process with a broad pattern. The last section explains why.

## `/cbm` reports the executable is missing but the binary works in your shell

The command prints this exact text.

```text
⚠️  codebase-memory-mcp executable not found. Install codebase-memory-mcp or set CBM_EXE.
```

**Cause.** The command calls `findExe()` against the environment of the DSH process, not your interactive shell. A `PATH` entry added by a shell startup file is invisible there. A `CBM_EXE` value that points to a missing file is ignored, and discovery continues, so a typo looks identical to a missing install.

**Fix.**
1. Print the absolute path your shell resolves.

```bash
command -v codebase-memory-mcp
```

2. Set `CBM_EXE` to that absolute path in the environment that launches DSH.
3. Confirm the file mode allows execution.
4. Restart DSH from that environment.
5. Run `/cbm` again and compare the `Executable` line.

## Registration warnings appear in the log

A warning carries the prefix `[codebase-memory] <label> registration failed: <message>`, where the label is `systemPrompt`, `skills`, or `commands`. Inner warnings use `[codebase-memory] systemPrompt.section failed:` and `[codebase-memory] commands.register failed:` and `[codebase-memory] skill register failed:`.

**Cause.** `ctx.inject` threw, or the injected service callback failed. The prompt, skill, and command packages are optional peer dependencies. A missing one usually removes the capability quietly, while a real failure logs the warning.

**Fix.**
1. Read the label to see which capability is lost.
2. Confirm the matching peer package is installed at a supported version.
3. Check the message after the colon for the failing call.
4. Reload the DSH profile.
5. Keep using the tools when only an optional capability fails. Tools register on a separate path that skips failures without a warning.

## Collecting evidence before you file an issue

Run these commands and attach their output to the report.

```bash
codebase-memory-mcp --version
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9749/
dsh --version
pgrep -af "codebase-memory-mcp" | grep -v pgrep
```

The `curl` status `200` means the UI is up, and `000` means nothing is listening. The `pgrep` line lists the daemon without touching it, and the `grep -v pgrep` filter drops the pipeline itself.

Never run `pkill -f "codebase-memory-mcp"`. The pattern also matches the shell command that carries it, so the kill takes down the wrapping shell and can end your session before any output is saved.

Also include the stderr block from startup, the full text of any `cbm_*` tool result, and the output of `cbm_projects(reason="collect evidence")`.
