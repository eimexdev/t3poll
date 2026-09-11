# Agent setup

Use this guide when asked to install or configure t3poll. For an existing installation update, follow [README updates](../README.md#updates).

Keep the running T3 server and ongoing conversations intact. Setup does not require restarting T3, interrupting a provider, registering a watch, or sending a test message. Follow the user's session constraints on configuration and credential changes.

## 1. Locate and build

Reuse an existing checkout of `https://github.com/eimexdev/t3poll`; otherwise clone into `~/code/t3poll`. Preserve local changes. Check the prerequisites and run the build from [manual setup](setup.md#manual-setup). Verify GitHub authentication with `gh auth status`; ask the user to sign in only if needed. MCP does not require `npm link`.

Done when `dist/cli.js` exists and Node and authenticated GitHub CLI are available to the intended MCP process.

## 2. Find the T3 connection

Reuse an existing t3poll MCP entry when it targets the user's intended server. Otherwise inspect the selected T3 installation's runtime state. Recent T3 source writes `server-runtime.json` beneath its state directory. Common candidates are:

- `$T3CODE_HOME/userdata/server-runtime.json`, if that home is configured.
- `~/.t3/userdata/server-runtime.json` for the default installation.
- A T3 worktree's `.t3/userdata/server-runtime.json`, or a home with `dev/server-runtime.json`, for development instances.

Read `origin` and `pid`. Verify the process is alive and belongs to the selected T3 instance; a leftover file or reused PID is not sufficient. For development instances, inspect the matching version's configuration to distinguish the backend origin from the browser URL. Ask the user to choose if multiple instances are plausible. For a remote server, or an installation without runtime state, obtain the URL from its existing configuration or the user. Do not guess the port.

Set the discovered origin as `T3POLL_URL` in the eventual MCP entry. Discovery is a setup step; t3poll itself currently requires that variable.

Reuse a suitable credential file if one is already configured. Otherwise follow [credential issuance](setup.md#connect-t3) using the CLI matching that T3 installation and its actual data directory. The documented command targets `userdata`; a development instance using `dev` requires the matching CLI's supported directory selection. Resolve that before issuing a token. Keep token contents out of chat, logs, and Git. Preserve any existing credential until its replacement succeeds.

Done when the intended origin and an owner-only credential file are identified. Record token expiration for the user.

## 3. Register MCP

Use the entry in [manual MCP setup](setup.md#register-mcp), with absolute paths to the built script and credential file. Use an absolute Node path if the provider's PATH differs from the interactive shell.

Merge only the t3poll entry into the Codex configuration home used by T3's provider. Preserve unrelated settings. If the provider uses a different account, container, or configuration home, configure that environment rather than assuming the interactive shell's defaults. Leave `T3POLL_THREAD_ID` unset unless the user wants one fixed destination for all watches.

Done when the intended client's configuration points to this checkout and the selected T3 instance. Let the client load it through an MCP reconnect or a new provider session; do not interrupt an ongoing conversation to force a reload.

## 4. Verify and report

Run the [verification steps](setup.md#verify) using the same connection settings. If an existing state directory contains active watches, remember that `list` may restart monitoring. Use a temporary `T3POLL_HOME` for connection verification when monitoring is outside the authorized scope, then remove that temporary directory.

If the client can load MCP now, verify it exposes exactly `watch`, `list`, and `stop`. Otherwise report that MCP verification awaits a reconnect or new session. A successful CLI connection alone does not prove the client loaded MCP.

Report the checkout path, selected T3 address, changed configuration file, credential path and expiration, and verification result. Never include the token. Explain any remaining user action in one sentence. Setup is complete when the client exposes the tools and a connection check lists T3 threads without sending a message.
