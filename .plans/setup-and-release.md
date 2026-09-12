# Setup and release work order

Status: Windows x64 support is implemented and tested on Gideon; see [verification](../docs/compatibility.md#windows-verification). The setup installer is implemented; see [installer usage](../docs/installer.md). The npm release workflow is implemented; see [release operations](../docs/releases.md). Worker update handoff is implemented; see [update behavior](../docs/updates.md).

## Order of work

1. Establish a native Windows test environment and prove the connection and worker behavior before finalizing the wizard's platform assumptions. Add a Windows CI lane. WSL tests do not establish native Windows support.
2. Build the TypeScript `t3poll setup` wizard for Codex inside T3, reusing discovery and managed credentials. Implement Windows support alongside the shared setup code once the platform approach is proven.
3. Publish an initial nightly and enable trusted GitHub publishing, with packed-install checks on Linux, macOS, and Windows.
4. Implement and test automatic worker handoff against published versions, preserving active watches and pending deliveries.
5. Manually publish stable from a commit already tested on nightly after upgrade verification.

## Windows proof

Current process inspection in `src/local-process.ts` explicitly supports Linux and macOS only. Check native T3 CLI and desktop layouts, process identity and ownership, command-line decoding, home discovery, and credential issuance. Retain verification of the selected live instance before issuing credentials.

Exercise executable resolution, npm command shims, spaces and non-ASCII characters in paths, PowerShell invocation, user-private credential ACLs, SQLite locking, atomic replacement, and detached worker startup and shutdown. Do not assume Unix modes or signal behavior establish Windows correctness.

Use a real Windows machine or VM for installation and end-to-end checks, plus repeatable Windows CI coverage. Record exactly which T3 distributions and architectures were exercised.

## Wizard

Provide instance selection and custom-location fallback, resolve the selected Codex provider configuration, preview changes, preserve unrelated settings, back up changed files, support dry runs, and make reruns repair or update an existing installation without duplicate entries.

Default to T3-only tool availability. Update both Codex MCP registration and the selected T3 provider's launch arguments, checking environment overrides. Keep each installation's destination separate when multiple T3 instances share Codex configuration. See [T3 scoping](t3-only-mcp.md).

Inherit the release channel from the invoked package version; do not ask a channel question. Stable packages configure latest and nightly packages configure nightly. Do not pin ordinary installations to the setup version. A local runtime path supports checkout use before publication.

Verification must not send messages or restart existing watches as a side effect. Preserve running T3 conversations and state which checks require a fresh provider session.

## Updates and release channels

The MCP launch command should resolve the selected npm channel on startup. A new package does not replace JavaScript already loaded by an MCP process or detached worker. Complete [worker handoff](worker-updates.md) so new code can take over monitoring safely, including when old and new MCP clients coexist.

Define update timing explicitly: startup-time channel resolution is the baseline; checking for updates during an uninterrupted MCP session is a separate decision. Include failed-download behavior, stored-state compatibility, and channel switching in the design. Avoid older clients or another channel repeatedly replacing the active worker.

Reference inspected: the local T3 Code checkout's `.github/workflows/release.yml` and `.github/scripts/check-nightly-release.cjs`. Its scheduler checks twice hourly, requires new commits and a six-hour release gap, and publishes nightlies to the `nightly` npm tag. Manual stable releases build the latest published nightly's commit under a stable version. T3 also supports stable tag-push releases. Adopt the tested-commit promotion approach; its exact cadence is not a requirement for t3poll.

Stable publication must be explicit and must not accidentally advance `latest` from a nightly job. Preserve source-commit traceability and serialize publishers so channel tags cannot move backward due to overlapping jobs. npm distribution tags select published versions; they do not update running processes.
