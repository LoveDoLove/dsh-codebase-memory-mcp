# Install the codebase-memory plugin for DeepSeek Harness

This page takes `@lovedolove/dsh-codebase-memory-mcp` from nothing to a running graph daemon. You end with the `cbm_*` tool family, the `/cbm` command, and a graph UI on port 9749.

## Before you start

Check three things before you install anything.

- Node.js `>=18.0.0 <25.0.0`. That is the `engines.node` range in `package.json`.
- The DeepSeek Harness CLI, `>=0.2.0 <0.3.0`. That is the `engines.dsh` range.
- The `codebase-memory-mcp` binary. Any recent release works. The next section covers three ways to get it.

The binary is not required to load the plugin. It is required for every query. Without it the `cbm_*` tools return a degraded result and `/cbm` prints an install hint.

## Install the plugin

Run the install command against the profile you boot.

```bash
dsh plugin --profile web add @lovedolove/dsh-codebase-memory-mcp
```

`default` and `web` are the usual profile names. Substitute your own profile name when it differs.

`dsh plugin` forwards its arguments to pnpm inside the profile directory. The package declares `dsh.bundle.patch`, so DSH activates the bundle on its own. You do not need a separate mount step.

Use a bundle patch only when you manage the profile by hand. Add the package to `dependencies` in `$DSH_HOME/profiles/<name>/package.json`. List it under `dsh.profile.bundles` as well. Then run a package install in that directory. The shipped `cordis.patch.yml` mounts the entry.

```yaml
- insert:
    - id: codebase-memory
      name: '@lovedolove/dsh-codebase-memory-mcp'
```

## Install the binary

Pick one of these three paths.

1. Run the upstream installer. Confirm the flags with `codebase-memory-mcp --help`. That output lists the `install` options. The `install` subcommand itself rejects `--help`, so do not pass it there.

   ```bash
   codebase-memory-mcp --help
   codebase-memory-mcp install
   ```

   The installer accepts `-y`, `-n`, `--force`, `--dry-run`, `--dir=<path>`, `--skip-config`, and `--clients=<tokens>`. Run `codebase-memory-mcp install --clients` to list the client tokens.

2. Place the release binary in `~/.local/bin`. The plugin searches that directory before the system directories.

   ```bash
   mv ./codebase-memory-mcp ~/.local/bin/codebase-memory-mcp
   chmod +x ~/.local/bin/codebase-memory-mcp
   ```

3. Point `CBM_EXE` at a binary you already have. Set `CODEBASE_MEMORY_EXE` instead when that suits your setup. `CBM_EXE` wins when both are set.

   ```bash
   export CBM_EXE=/opt/codebase-memory-mcp/codebase-memory-mcp
   ```

The discovery order is `CBM_EXE`, then `CODEBASE_MEMORY_EXE`, then `~/.local/bin`, `/usr/local/bin`, `/usr/bin`, the current directory, and `PATH`. On WSL the client also checks for a Windows `.exe` on `PATH`.

Confirm the binary runs.

```bash
codebase-memory-mcp --version
```

The output is one line such as `codebase-memory-mcp 0.12.1`.

## Confirm it worked

Restart DSH after you install the binary. The executable path is resolved when the shared client is constructed, so a running profile keeps the old result.

Watch stderr in the terminal that booted DSH. The daemon prints this banner on success.

```text
[codebase-memory] 🔍 codebase-memory UI is live: http://localhost:9749/
```

When no executable is found, the same stream prints this line instead.

```text
[codebase-memory] codebase-memory-mcp executable not found; the graph UI stays off. Install codebase-memory-mcp or set CBM_EXE.
```

Check the daemon directly at any time. The response code must be `200`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9749/
```

Type `/cbm` in a DSH session for a status report. It prints the resolved executable path, the Web UI link, and the indexed projects. Calling `/cbm` retries the daemon start, so it also works as a second attempt after a failed boot.

## Build your first index

The plugin queries indexes. It does not create them. Run the upstream CLI to build one.

```bash
codebase-memory-mcp cli --quiet index_repository '{"repo_path":"/absolute/path/to/repo"}'
```

Pass an absolute path. A relative path is resolved against the current directory, which may differ from the repository you mean.

No `cbm_*` tool builds an index. The plugin is query-only by design.

The library API `indexRepository` does build one. It ships as a method on the engine class in `src/engine.mjs`. Use `codebase-memory-mcp cli` when you want the command line path.

After the index finishes, call `cbm_projects` with a short `reason` string. The repository should appear in the list.

## Upgrade

Run the same install command with the `@latest` tag.

```bash
dsh plugin --profile web add @lovedolove/dsh-codebase-memory-mcp@latest
```

`add` forwards to pnpm, so the `@latest` tag is honoured and the profile picks up the newest release. The plugin has no upgrade command of its own. Reload the profile afterwards so the new code loads.

The binary has its own update command.

```bash
codebase-memory-mcp update
```

## Uninstall

Remove the package from the profile.

```bash
dsh plugin --profile web remove @lovedolove/dsh-codebase-memory-mcp
```

`remove` forwards to pnpm inside the profile directory. The binary stays in place after this command. Delete it yourself, or run `codebase-memory-mcp uninstall` to remove it and its configuration.
