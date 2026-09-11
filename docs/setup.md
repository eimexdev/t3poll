# Manual setup

Requires Windows x64, macOS, or Linux, Node.js 24.10+, [GitHub CLI](https://cli.github.com/) signed in, and a running local T3 installation. Nothing is published to npm yet.

## Install

Reuse your checkout, or clone into a directory of your choosing:

```sh
git clone https://github.com/eimexdev/t3poll.git
cd t3poll
npm ci
npm run build
```

Run `gh auth login` if needed. t3poll only reads GitHub.

## Register MCP

Add this entry to the Codex configuration used by T3's provider:

```toml
[mcp_servers.t3poll]
command = "node"
args = ["/absolute/path/to/t3poll/dist/cli.js", "mcp"]
```

Use an absolute Node path if the provider's PATH differs from your terminal. This is common with macOS desktop apps and Node version managers. `node -p process.execPath` prints the runtime path. GitHub CLI must also be on the MCP process's PATH. For Homebrew on Apple Silicon, an example is:

```toml
[mcp_servers.t3poll.env]
PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

On Windows, use an absolute `node.exe` path and forward slashes in TOML paths, for example:

```toml
[mcp_servers.t3poll]
command = "C:/Program Files/nodejs/node.exe"
args = ["C:/Users/you/code/t3poll/dist/cli.js", "mcp"]
```

`gh.exe` must be on the MCP process's PATH. Native Windows uses the same `~/.t3` home convention, with `~` resolving to your Windows user profile. Windows requires x64 Node; WSL is a separate Linux installation.

Merge optional settings into this same environment table. Load the entry in a new provider session or reconnect MCP. T3 itself does not need restarting.

## Verify

Call `list` with `threads=true` through MCP, or run from the checkout:

```sh
node dist/cli.js list --threads
```

This discovers T3 and creates a credential if needed, then lists destination threads. It sends no messages. `list` can also restart existing saved watches. The MCP client should expose `watch`, `list`, and `stop`.

Ask the agent to watch a PR and select its destination thread. Thread selection remains explicit; cwd does not identify a conversation.

## Automatic connection

Discovery checks `T3CODE_HOME`, or `~/.t3` by default, and `.t3` directories in the current directory and its parents. It reads `userdata/server-runtime.json` and verifies the live process, its owner, installed T3 CLI, and data directory. Linux uses `/proc`. macOS reads exact process arguments through native system APIs, using the bundled Koffi dependency, and uses the system `ps` and `lsof` commands for ownership and file checks. Windows x64 reads the process owner, executable, command line, environment, and working directory through native APIs using Koffi. Paths containing spaces and symlinked installations are supported.

On macOS and Windows x64, the packaged T3 Code desktop app is also supported. t3poll locates its bundled server and runs its auth CLI through Electron in Node mode. It checks that the server has the selected home's `userdata/state.sqlite` open, using Windows Restart Manager on Windows, since desktop bootstrap can pass the home through a pipe. No separate global `t3` installation is needed. Stale files are ignored.

The matching T3 CLI issues a 30-day credential. t3poll verifies it before saving it with private permissions under `T3POLL_HOME/credentials`. Windows uses protected ACLs granting the current user access; Unix uses owner-only modes. Existing Windows token files must not grant access to other users, except SYSTEM and Administrators, and must be owned by the current user, SYSTEM, or Administrators. It replaces managed credentials on use within one day of expiration, or after expiration. MCP and the worker coordinate replacement across processes. Failed replacement preserves the previous token and continues using it until expiration, retrying renewal after five minutes; no other service needs to run. Previous successfully used sessions expire naturally. A newly issued session that fails verification is revoked. Failed revocation is recorded and retried before issuing another session.

This T3 CLI issues administrative scopes. t3poll uses orchestration read/operate access. Manual token files are neither adopted nor renewed automatically.

## Select an instance or use manual credentials

For multiple local instances, add the selected home, the directory containing `userdata`:

```toml
[mcp_servers.t3poll.env]
T3POLL_BASE_DIR = "/absolute/path/to/t3-home"
```

`T3POLL_URL` can also select a discovered instance by origin. Credentials for different homes/origins are stored separately. Saved watches stay attached to their original origin; a server port change requires registering the watch again.

Automatic setup supports installed T3 Node CLI processes on Windows x64, macOS, and Linux, and packaged Windows x64 and macOS T3 desktop apps, with the `userdata` layout. Source runners, the older `dev` layout, and remote connections use explicit settings instead:

```toml
[mcp_servers.t3poll.env]
T3POLL_URL = "http://127.0.0.1:3773"
T3POLL_TOKEN_FILE = "/absolute/path/to/token"
```

For a standard `userdata` installation, the matching CLI can issue a manual token with `t3 auth session issue --base-dir /path/to/t3-home --label t3poll --ttl 30d --token-only`. Capture stdout directly into an owner-only file, never chat or Git. Other layouts require that version's directory options. Remote origins require HTTPS.

## Optional terminal command

Run `npm link` if you want a global `t3poll` command. MCP does not need it. Optional connection overrides must also be set in the terminal when using the CLI.
