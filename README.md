# t3poll

Watch a GitHub PR and wake an existing T3 Code conversation when something changes.

Three MCP tools: `watch`, `list`, and `stop`. The same operations are available from the CLI. Calling `watch` starts a background worker automatically. It polls every 60 seconds without invoking a model, sends a short notification through T3 when something changes, and exits when there is nothing left to watch.

The agent uses its existing GitHub tools to read comments and logs. No skill is required.

## Install

Requires Node.js 24.10 or newer, [GitHub CLI](https://cli.github.com/), and a T3 server with the orchestration HTTP API. Linux is the initial supported platform.

```sh
git clone https://github.com/eimexdev/t3poll.git
cd t3poll
npm ci
npm run build
npm link
```

Run `gh auth login` if GitHub CLI is not already signed in. Only GitHub reads are used.

## Connect T3

Set the T3 server origin and the path to a file containing its bearer token:

```sh
export T3POLL_URL="http://127.0.0.1:3773"
export T3POLL_TOKEN_FILE="$HOME/.config/t3poll/token"
```

Use your server's actual port. Remote origins require HTTPS; a local tunnel can use HTTP on loopback. Tokens stay in the protected file, never in MCP arguments or watch output.

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

## Use through MCP

Add this to your Codex MCP configuration, using absolute paths. T3's Codex provider must use the same Codex configuration home. Restart the relevant provider session after configuring MCP.

```toml
[mcp_servers.t3poll]
command = "node"
args = ["/absolute/path/to/t3poll/dist/cli.js", "mcp"]

[mcp_servers.t3poll.env]
T3POLL_URL = "http://127.0.0.1:3773"
T3POLL_TOKEN_FILE = "/absolute/path/to/.config/t3poll/token"
```

Then ask the agent to watch your PR. Tool calls look like this:

```text
list  { "threads": true }
watch { "pr": "https://github.com/owner/repo/pull/123", "threadId": "<chosen T3 thread ID>" }
list  {}
stop  { "id": "<watch ID>" }
```

`list` with `threads=true` shows available thread IDs and titles. Select the destination explicitly. Neither MCP nor cwd reliably identifies the current T3 thread. For a dedicated installation you can set `T3POLL_THREAD_ID` to a fixed destination, then omit `threadId` from calls.

The MCP call returns after the initial GitHub/T3 checks and worker startup. It does not stay open while monitoring. The worker continues when the MCP client disconnects. A skill is unnecessary because the tool descriptions explain the workflow.

## Use from the terminal

```sh
t3poll list --threads
t3poll watch https://github.com/owner/repo/pull/123 --thread THREAD_ID
t3poll list
t3poll stop WATCH_ID
```

An optional `--interval 30`, or `intervalSeconds: 30` through MCP, changes the poll interval. The default is 60 seconds; the accepted range is 15–3600 seconds. Repeating `watch` for the same PR and destination returns the existing watch, without changing its interval or expiration. Stop and watch again to reset it.

## What the agent receives

```text
[t3poll] New activity on https://github.com/owner/repo/pull/123
Watch: <ID>. Head: <commit>.

- Comment 456 was added or updated.
  https://github.com/owner/repo/pull/123#issuecomment-456
- Check "tests": failure.
  https://github.com/owner/repo/actions/runs/789

Inspect the changes with your existing GitHub tools and continue
the assigned task under this thread's existing permissions.
```

Comment bodies and CI logs are not copied into the message. The agent fetches what it needs. t3poll does not merge, push, approve, or post comments.

## Behavior

- The first read establishes a baseline. Existing feedback does not cause a notification.
- New or edited comments/reviews, terminal CI results, head commits, and closure/merge are detected. Check reruns and legacy commit statuses are included; queued/running checks stay quiet.
- Changes found in one poll become one notification. Changes accumulate while the destination is busy or awaiting input/approval.
- Watches finish after the final closure/merge notification, stop on request, or expire after 24 hours. Expiration cancels remaining unsent work.
- T3/GitHub failures retry with backoff. `list` shows polling and delivery errors. A timed-out dispatch retains the same command and message IDs for retry.
- `lastDelivery` means T3 accepted the command. It does **not** mean the agent completed the work. Provider failures remain in T3; t3poll does not blindly send the message again.
- Stopping cancels unsent work. An HTTP request already in flight may still be accepted and run.
- There is no startup service. After a reboot or worker crash, calling `watch` or `list` restarts saved active watches. The machine must be awake and T3 available for delivery.

State lives in `~/.local/share/t3poll`, or `T3POLL_HOME`. All clients using the same directory share one worker. Keep that directory private. The worker writes startup/crash diagnostics to `worker.log`; ordinary unchanged polls are silent.

See [compatibility and limitations](docs/compatibility.md) and [why polling comes before webhooks](docs/webhooks.md).

## Development

```sh
npm ci
npm test
npm run check
```

Tests use temporary state, fake GitHub responses, and scripted destinations. The optional [stock T3 proof](docs/compatibility.md#stock-release-proof) starts its own isolated T3 instance. It never uses a running server or real provider account.
