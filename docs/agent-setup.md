# Agent setup

Use this guide when a user asks you to install, configure, or repair t3poll. Run the published setup installer on the machine running T3 Code. A standard installation needs no repository checkout, build, global npm installation, skill, or manually written MCP entry.

## Install through the agent

1. Check `node --version`, `npm --version`, and `gh auth status`. Node must be 24.10 or newer. T3 Code must be running with a Codex provider available. Windows requires x64 Node; WSL is a separate Linux installation. Use the user's existing Node, GitHub CLI, and Codex installations. If GitHub authentication is missing, have the user complete `gh auth login`, then continue. Do not request or print tokens.
2. Use `@latest` by default. Use `@nightly` when the user requests nightly or is repairing an installation that already follows nightly. Do not ask a release-channel question for a standard installation. Read the installed command when repairing an existing setup so its channel, selected instance, and custom state directory are preserved.
3. Preview the actual installation:

   ```sh
   npx --yes t3poll@latest setup --dry-run --yes
   ```

   The first `--yes` accepts npm's package-install prompt. The final `--yes` selects the installer's noninteractive flow. `--dry-run` previews without changing files or credentials. Inspect the selected instance URL, Codex configuration, changed file paths, global-entry migration, and any reported launch-environment conflict.
4. Resolve only missing selections. If multiple T3 instances are found and the intended one is not established in the conversation, ask which instance the user wants and pass its T3 home with `--base-dir`. If multiple Codex providers are reported, use the intended provider ID with `--provider`. These are distinct from the Codex config home and t3poll state home. Use `--codex-home` or `--state-home` only for an established custom location. Repeat the preview with the selected options until it identifies the intended configuration and reports no blocking conflict. A dry run can report an environment conflict and still exit successfully, so inspect its output.
5. Apply setup using the same channel and selection options, omitting only `--dry-run`:

   ```sh
   npx --yes t3poll@latest setup --yes
   ```

   A request to set up t3poll authorizes the normal installer changes. Do not insert another approval round for the plan or its backups. Ask when a destination or consequential preference is genuinely unresolved. The installer owns configuration editing, credential creation, and verification; do not recreate those steps manually.
6. Check that setup reports success. It tests the configured MCP command and tool catalog, then verifies a managed credential by reading T3's thread list. Open a new Codex session in the selected T3 instance, or have the user do so when you cannot. Verify that session exposes `watch`, `list`, and `stop`. If you cannot inspect the new session, report that installation verification passed and session-level tool availability is still pending. Do not claim the existing conversation has acquired tools it has not loaded.

To supply selections, append the same options to both commands, for example `--base-dir "/path/to/T3 home" --provider "provider-id"`. Use actual discovered paths and IDs, not these placeholders. Quote paths containing spaces on every platform.

## Scope and verification

The installer creates a deterministic `t3poll_<id>` entry that is disabled in the Codex config, binds it to the selected T3 home and state directory, and enables it through that T3 provider's launch arguments. Preserve this T3-only scope. It chooses executable paths, preserves unrelated settings, and backs up changed configuration files.

An enabled old global `t3poll` entry is disabled by the recommended `--yes` flow. Explain that the tools are intended for Codex sessions inside T3. Use `--keep-global` only when the user explicitly wants global availability; do not add it by default.

Setup does not create a watch or deliberately send a test message. However, starting the MCP runtime can resume saved active watches in the selected state directory, and those watches can deliver notifications. Do not describe an existing-state setup as guaranteed free of monitoring side effects. For a requested isolated test, use a separate `--state-home`; that configures the selected provider to use the test state, so it is not a substitute for verifying the intended production installation.

Report the selected T3 URL and Codex configuration, changed config paths, channel, and verification result. Never report credential contents. Keep the running T3 server and conversations intact. If a launch-environment override requires a T3 restart, explain the specific blocker and leave the restart to a suitable moment chosen by the user. See [launch-argument conflicts](installer.md#launch-argument-conflicts) for that branch.

## Repair, updates, and development

Rerunning setup repairs the managed registration without duplicating entries. Preserve the existing channel and custom selections. Ordinary MCP launches follow that channel using npm's normal cache behavior in current source; previously generated entries retain their arguments until setup is rerun with an updated installer.

For an explicit runtime freshness check or worker update, follow [update behavior](updates.md). Updating the worker alone does not rewrite saved MCP launch arguments or refresh an existing session's tool catalog.

Use a checkout and `--runtime-path` only when the user requests development or a local build. Follow [the installer guide](installer.md) for that path. Consult [manual setup](setup.md) only for deliberate manual configuration or unsupported layouts, not as the normal agent installation procedure.
