# Manual setup

Requires Node.js 24.10 or newer, [GitHub CLI](https://cli.github.com/), and a T3 server with the orchestration HTTP API. Linux is the initial supported platform.

```sh
git clone https://github.com/eimexdev/t3poll.git
cd t3poll
npm ci
npm run build
```

Run `gh auth login` if GitHub CLI is not already signed in. Only GitHub reads are used.

## Connect T3

Set the T3 server origin and the path to a file containing its bearer token:

```sh
export T3POLL_URL="http://127.0.0.1:3773"
export T3POLL_TOKEN_FILE="$HOME/.config/t3poll/token"
```

Use your server's actual port. A local setup agent can often discover it; see [agent setup](agent-setup.md). t3poll currently requires this setting explicitly. Remote origins require HTTPS; a local tunnel can use HTTP on loopback. Tokens stay in the protected file, never in MCP arguments or watch output.

If you need a token, T3 v0.0.40 can issue one using the following command. Set `T3_BASE_DIR` to the **existing T3 data directory**, the directory containing `userdata`. This command creates a credential in that environment. Its token has administrative scopes in this T3 release, although t3poll only uses orchestration read/operate access.

```sh
export T3_BASE_DIR="/path/to/your/existing/t3-home"
mkdir -p "$HOME/.config/t3poll"
chmod 700 "$HOME/.config/t3poll"
umask 077
t3 auth session issue --base-dir "$T3_BASE_DIR" --label t3poll --ttl 30d --token-only > "$T3POLL_TOKEN_FILE"
chmod 600 "$T3POLL_TOKEN_FILE"
```

Use the CLI matching your installed T3 release. If you already have a credential with `orchestration:read` and `orchestration:operate`, use that instead. Replacing the token file rotates credentials for active watches without restarting them.

## Register MCP

Add this to your Codex MCP configuration, using absolute paths. T3's Codex provider must use the same Codex configuration home. Load the configuration in a new provider session, or reconnect MCP if your client supports it. Keep ongoing work intact.

```toml
[mcp_servers.t3poll]
command = "node"
args = ["/absolute/path/to/t3poll/dist/cli.js", "mcp"]

[mcp_servers.t3poll.env]
T3POLL_URL = "http://127.0.0.1:3773"
T3POLL_TOKEN_FILE = "/absolute/path/to/.config/t3poll/token"
```

After the client loads the tools, ask the agent to watch your PR. Tool calls look like this:

```text
list  { "threads": true }
watch { "pr": "https://github.com/owner/repo/pull/123", "threadId": "<chosen T3 thread ID>" }
list  {}
stop  { "id": "<watch ID>" }
```

`list` with `threads=true` shows available thread IDs and titles. Select the destination explicitly. Neither MCP nor cwd reliably identifies the current T3 thread. For a dedicated installation you can set `T3POLL_THREAD_ID` to a fixed destination, then omit `threadId` from calls.

The MCP call returns after the initial GitHub/T3 checks and worker startup. It does not stay open while monitoring. The worker continues when the MCP client disconnects. A skill is unnecessary because the tool descriptions explain the workflow.

## Verify

From the checkout, with the two environment variables above set:

```sh
node dist/cli.js list --threads
```

This checks the credential and lists available destinations without sending a message. `list` also restarts any saved active watches; on a fresh installation there are none. Verify that the MCP client exposes `watch`, `list`, and `stop` after loading its configuration.

For a global `t3poll` terminal command, optionally run `npm link`. MCP uses the absolute script path and does not need it. Your terminal needs the connection variables too; the MCP configuration only supplies them to MCP.
