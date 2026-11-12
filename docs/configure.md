# Configure the codebase-memory plugin

The plugin `@lovedolove/dsh-codebase-memory-mcp` registers the `cbm_*` tool family, an
optional system prompt section, an optional skill, and the slash command `cbm`. Four
plugin options, three environment variables, and one metadata path control it.

Plugin options live in the `codebase-memory` entry of `cordis.yml`, validated by the
Schemastery `Config` object in `src/index.mjs`. Environment variables come from
`process.env` at run time, and the plugin option wins when both name an executable. The
bundle patch `cordis.patch.yml` inserts the entry and sets no options, so the defaults
here apply to a fresh install.

## Plugin options

These four fields are the whole `Config` schema, and the block is the config object itself.

```yaml
exePath: /usr/local/bin/codebase-memory-mcp
uiEnabled: true
port: 9749
eagerStart: true
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `exePath` | string | none | Path to the `codebase-memory-mcp` binary. Falls back to `CBM_EXE`, then PATH discovery. |
| `uiEnabled` | boolean | `true` | Passes `--ui=true` and advertises the graph UI. When false, passes `--ui=false` instead. |
| `port` | number | `9749` (`DEFAULT_UI_PORT`) | Preferred daemon UI port. Sent as `--port=<port>` only when `uiEnabled` is true. |
| `eagerStart` | boolean | `true` | Starts the daemon as soon as the plugin loads. When absent, the test-runner guard decides. |

`exePath` has no default. Its absence is not an error, because the client falls back to
environment variables then discovery. `apply` derives a port with `config.port ||
DEFAULT_UI_PORT`, and the system prompt section, the `cbm` command description, and the
startup banner all use that derived value.

## Environment variables

| Variable | Read by | Meaning |
| --- | --- | --- |
| `CBM_EXE` | `findCodebaseMemoryExe` | Absolute path to the binary. Accepted only when `existsSync` passes. |
| `CODEBASE_MEMORY_EXE` | `findCodebaseMemoryExe` | Second path, checked after `CBM_EXE` under the same test. |
| `DSH_HOME` | `CodeIntelligenceEngine.getMetadataPath` | Base directory for index metadata. Not read by `findCodebaseMemoryExe`. |

`findCodebaseMemoryExe(env = process.env)` resolves in this exact order.

1. `env.CBM_EXE`, when set and `existsSync` returns true.
2. `env.CODEBASE_MEMORY_EXE`, when set and `existsSync` returns true.
3. The platform candidate directories listed in the next section.
4. Every non-empty entry of `env.PATH`, split on the platform `delimiter`.
5. The WSL interop check, on non-Windows hosts only.
6. `null`, when nothing matches.

A variable that points at a missing file is skipped without a warning, so a later
candidate can still match, and the function never throws. The client constructor runs
`opts.exePath || findCodebaseMemoryExe(opts.env)`, which makes `exePath` the top priority
source and `CBM_EXE` the top priority variable. `DSH_HOME` never affects executable
discovery, only index metadata.

## Executable discovery

The candidate list depends on `process.platform === 'win32'`. The name is
`codebase-memory-mcp.exe` on Windows and `codebase-memory-mcp` on other systems.

On Windows the order is `exePath`, `CBM_EXE`, `CODEBASE_MEMORY_EXE`,
`%HOME%\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe`, the
executable in `process.cwd()`, then each `PATH` entry. The WSL check does not apply.

On Linux, macOS, and other POSIX systems the order is `exePath`, `CBM_EXE`,
`CODEBASE_MEMORY_EXE`, `~/.local/bin/codebase-memory-mcp`,
`/usr/local/bin/codebase-memory-mcp`, `/usr/bin/codebase-memory-mcp`, the executable in
`process.cwd()`, each `PATH` entry, then the WSL check.

The WSL branch runs only when the platform is not Windows and
`/proc/sys/fs/binfmt_misc/WSLInterop` exists. It walks the same `PATH` entries again and
looks for `codebase-memory-mcp.exe` in each directory, reading no Windows mount points
directly. A hit returns the Windows executable for the interop handler to run.
`isAvailable` rechecks `existsSync` on each read, so a binary installed later appears
without a restart.

## Startup

`eagerStart` decides when the first spawn happens. When true, `cbmApply` calls
`autoStartCodebaseMemory` inside `apply`, so the daemon starts while the plugin loads.
When false, `apply` spawns nothing and the first tool call reaches `ensureStarted` and
pays the cost there.

When `eagerStart` is undefined, the daemon stays down if any of these is true.

- `process.env.NODE_ENV === 'test'`.
- `process.execArgv` includes `--test`.
- `process.argv` includes `--test`.
- A `process.argv` entry ends with `.test.mjs` or `.test.js`.

The guard covers only the undefined case. An explicit true starts the daemon even under a
test runner, and an explicit false never starts it eagerly. If the binary is missing,
`autoStartCodebaseMemory` writes a warning to stderr and to the plugin logger, then
returns `null`. Tools stay registered and answer in degraded mode. On shutdown, a Cordis
effect from `cbmApply` calls `client.dispose()`, clears the shared client, and rejects
pending requests with `CodebaseMemoryClient stopped`.

## Daemon lifecycle

The client spawns the binary with `stdio` set to `['pipe', 'pipe', 'pipe']` and
`windowsHide` true. Arguments follow `uiEnabled` and `port`, so `--ui=false` drops the
port flag entirely.

```sh
codebase-memory-mcp --ui=true --port=9749
codebase-memory-mcp --ui=false
```

After spawn the client sends a JSON-RPC `initialize` request with protocol version
`2025-03-26`, an empty capabilities object, and client info `{ name: 'codebase-memory',
version: '0.1.0' }`. The handshake times out after 30 seconds. On success the client
stores `serverInfo` and sends `notifications/initialized`. Responses arrive line by line
on stdout, parse as JSON, and match a pending request by `id`. Malformed lines are
discarded, and stderr lines are logged at debug level unless they contain `warning:`.

Respawn is lazy. The `close` handler rejects every pending request with
`codebase-memory-mcp process closed (code: <code>)`, then sets `child` and
`startPromise` to `null`. No timer or retry starts a replacement. The next `rpc` call
reaches `ensureStarted`, finds no live child, and spawns a fresh daemon and handshake. A
spawn `error` event warns and rejects pending requests without clearing the handles.

`dispose` calls `stop`, which sets `isDisposed`, sends `SIGTERM` to the child, and
rejects all pending requests. A disposed client cannot start again, and `ensureStarted`
throws `CodebaseMemoryClient is disposed`. `engine.dispose` prefers `client.dispose`
over `client.stop`.

## Index metadata location

```text
$DSH_HOME/codebase-memory/projects/<projectId>/code_index.json
```

`getMetadataPath` builds the path in this order.

1. `this.config.getMetadataPath(repoRoot)`, when that function exists.
2. `this.config.home`, joined with `projects`, the project id, `code_index.json`.
3. `$DSH_HOME`, joined with `codebase-memory`.
4. `~/.dsh/codebase-memory`, when `DSH_HOME` is unset.

The unset case resolves to `~/.dsh/codebase-memory/projects/<projectId>/code_index.json`,
where `homedir()` supplies the home directory.

`<projectId>` is `cbmProjectName(repoRoot)` unless `config.projectIdFor` is provided. The
slug rules turn backslashes into forward slashes, strip a leading drive letter such as
`C:` and any leading separators, replace remaining separators with hyphens, prefix a
Windows result with `C-`, and fall back to `root` when the result is empty.

```text
/home/user/my-repo   -> home-user-my-repo
C:\Users\me\app      -> C-Users-me-app
```

`saveMetadata` writes the status object, creating parent directories with `mkdirSync` and
`recursive` true. Read and write failures are swallowed, so a locked directory costs
persistence but does not fail the index operation.

## Compatibility

| Engine | Range |
| --- | --- |
| `node` | `>=18.0.0 <25.0.0` |
| `dsh` | `>=0.2.0 <0.3.0` |

Every peer dependency is optional and none is bundled. The runtime dependency is
`@deepseek-ai/schemastery` at `~3.19.0`.

| Peer | Range |
| --- | --- |
| `@deepseek-ai/cordis` | `>=4.0.1-rc.1 <5.0.0-0` |
| `@deepseek-ai/dsh-commands` | `>=0.2.0 <0.3.0-0` |
| `@deepseek-ai/dsh-skill` | `>=0.2.0 <0.3.0-0` |
| `@deepseek-ai/dsh-system-prompt` | `>=0.2.0 <0.3.0-0` |
| `@deepseek-ai/dsh-tools` | `>=0.2.0 <0.3.0-0` |

Because the peers are optional, `injectCapability` calls `ctx.inject` only when that
method exists. A missing service is a silent skip, and a registration that throws inside
the callback is logged as a warning with the capability label.
