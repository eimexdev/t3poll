# Setup installer

Build the checkout and run setup with T3 open and GitHub CLI signed in:

```sh
npm ci
npm run build
node dist/cli.js setup --runtime-path ./dist/cli.js
```

`--runtime-path` uses this checkout's built CLI. Keep the checkout in place. To install the published package without a checkout, use:

```sh
npx t3poll@latest setup
```

Use `@nightly` instead to follow automatic nightly releases. There is no release-channel question. A stable package configures `latest`; a package whose version contains the nightly prerelease identifier configures `nightly`. npm does not pass its original tag to the program, so setup derives the channel from the running package's version. Unknown prerelease versions are rejected. An explicit local runtime opts out of npm updates.

## Flow

Setup checks GitHub sign-in and finds supported running local T3 instances from `T3CODE_HOME`, the default home, and ancestor `.t3` directories. It asks you to choose when more than one is found. A custom directory can identify other installations. It reads both legacy `providers.codex` and named `providerInstances` settings, with explicit instances taking precedence.

Setup opens with a welcome and a Yes/No prompt to proceed. It asks for an instance or provider only when selection is needed, and offers migration if an existing global entry is enabled. The summary identifies the T3 instance by URL and names the Codex configuration. It explains the tool registration, launch enablement, managed credential, connection checks, and backups before the Install confirmation. File paths are included in `--dry-run` details. Custom paths can be supplied through command-line options. To preview from a script without changing files or credentials:

```sh
node dist/cli.js setup --base-dir /path/to/t3 --provider codex --dry-run
```

Other options are `--codex-home`, `--state-home`, and `--yes`. `--yes` accepts the plan but does not guess when multiple instances or providers are available. `--help` lists all options. Setup does not start T3, sign into GitHub, or alter login credentials. If GitHub sign-in is needed, run `gh auth login` in another terminal, then retry.

## Configuration and scope

Each T3 home and Codex provider gets a deterministic `t3poll_<id>` MCP entry, disabled by default. Its environment binds the selected T3 home and t3poll state directory. Multiple installations can share Codex configuration without replacing each other's destinations.

The installer appends the corresponding `-c mcp_servers.t3poll_<id>.enabled=true` to the selected T3 provider's launch arguments. It preserves unrelated arguments, Codex text and comments, and other T3 settings. T3 JSON formatting may change. A rerun updates the owned MCP block and does not duplicate launch flags. Unknown entries and damaged managed blocks require correction rather than being overwritten. If a global `mcp_servers.t3poll` entry is enabled, setup asks whether to disable it and recommends Yes. Yes includes the change in the reviewed plan, preserves its other settings and comments, and backs it up. No preserves it and clearly notes that t3poll remains available outside T3. `--yes` accepts the recommended migration; add `--keep-global` to preserve the global entry when scripting setup.

Configuration files receive adjacent private `.t3poll-<id>.bak` backups before changes. The installer compares the files with the reviewed snapshot and refuses stale writes. If credential verification fails after applying, it restores the previous configuration unless another process has edited it. Backups remain for manual recovery. Adjacent `.t3poll-lock` files prevent overlapping installer writes; after a crashed installer, verify it is no longer running before removing a leftover lock. T3 itself does not participate in those locks, so review-time comparisons and rollback checks also protect against its edits.

The installer checks the selected Codex executable, starts the exact configured MCP command, and verifies the tool catalog. It then creates or reuses a managed T3 credential and reads the thread list to verify connectivity. It never calls `watch`, sends a message, or restarts a worker. Runtime checks can create t3poll state files, and failed attempts can leave those and credential metadata for recovery. Dry runs do not run these checks or write state.

Open a fresh Codex session in the selected T3 instance after setup. Existing sessions keep their current tool catalog. Scoping controls tool availability, not security isolation; users can deliberately enable the MCP entry elsewhere. Project-level or administratively managed Codex configuration can impose additional overrides outside this installer's control.

## Launch-argument conflicts

Having existing arguments is not a conflict. For example, `--enable some_feature -c model_reasoning_effort=high` is retained and the MCP flag is appended.

Setup stops when arguments override the same managed MCP entry, replace its parent `mcp_servers` table, have an unclosed quote or malformed config assignment, or contain `--` after which appending configuration flags is unsafe. The existing exact `enabled=true` override is reused. Other MCP entries are left alone.

`T3CODE_CODEX_LAUNCH_ARGS` is a precedence issue: a nonempty value overrides the saved launch arguments. Setup reads the live T3 process environment and the selected provider's environment, not just the terminal running setup. If the override already enables this entry, it can remain. Otherwise the wizard gives the exact flag to add and asks you to restart T3 and rerun setup. A global override affecting multiple Codex providers must be removed or moved into the selected provider's environment to preserve provider scoping. It never silently edits shell profiles, shortcuts, or another running process's environment.

T3 builds must contain support for `T3CODE_CODEX_LAUNCH_ARGS` in their server bundle. Unrecognized builds are rejected rather than silently installing an ignored setting. Shadow Codex homes use the shared configuration directory; setup follows an existing config symlink without replacing it.

## Updates

The npm launch command uses Node to run npm's CLI directly, including on Windows, avoiding batch-file quoting. It resolves the package channel at MCP startup and needs npm/network access. Verification must succeed before config is changed; there is no cached-version fallback during a failed install.

New MCP sessions resolve their npm channel and hand active watches to a newer worker after its current operation finishes. Existing MCP sessions keep their loaded code. See [update behavior](updates.md) for compatibility and recovery.
