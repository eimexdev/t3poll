# t3poll

Watch a GitHub PR and notify an existing T3 Code conversation when something changes.

Three MCP tools: `watch`, `list`, and `stop`. `watch` automatically starts a background worker that polls every 60 seconds without invoking a model. It survives MCP disconnection and exits when there is nothing left to watch. No skill or service installation is required.

## Agent setup

Copy this into your coding agent:

```text
Set up t3poll from https://github.com/eimexdev/t3poll.
Use an existing checkout if available; otherwise choose an appropriate local installation folder.
Read docs/agent-setup.md in that checkout and follow it.
Configure MCP to launch t3poll; it discovers local T3 and manages its credential.
Preserve my running T3 server and ongoing conversations.
Verify setup without sending a message to a thread or starting a watch.
```

The [agent setup guide](docs/agent-setup.md) covers discovery, credentials, configuration, and verification. Once installed, ask the agent to watch a PR and choose its destination conversation.

## Manual setup

You need Windows x64, macOS, or Linux, Node.js 24.10+, GitHub CLI signed in, and a compatible T3 server. Build this checkout and add one MCP configuration entry. The first thread-listing or watch call finds local T3 and creates its credential. Follow the [manual steps](docs/setup.md).

No URL or token settings are needed for a standard local installation. If multiple instances are found, select one with `T3POLL_BASE_DIR`. Choose the destination thread when registering each watch.

## Daily use

Ask your agent to watch a PR, list watches, or stop one. It can find destination IDs with `list { "threads": true }`.

The CLI provides the same operations. From the checkout, with T3 running:

```sh
node dist/cli.js watch https://github.com/owner/repo/pull/123 --thread THREAD_ID
node dist/cli.js list
node dist/cli.js stop WATCH_ID
```

Notifications contain a short description and links. The agent reads comments and logs with its existing GitHub tools. Running threads receive updates as steering through T3. Startup and approval/input prompts hold delivery, with a readiness check every 15 seconds. Watches expire after 24 hours or finish after notifying about closure/merge.

See [monitoring behavior](docs/behavior.md) for notification examples, polling options, retries, and recovery after a reboot.

## Updates

There is no automatic updater. Let active watches finish before updating, then run from the checkout:

```sh
git pull --ff-only
npm ci
npm run build
```

Reconnect the t3poll MCP server or use a new provider session to load the new code. The saved MCP entry still points to the same file. A running MCP process or worker keeps its old code until it exits; rebuilding alone does not upgrade it.

If you need to update sooner, record your watch destinations, stop those watches, wait for the worker to exit, then update and register them again. Re-registering starts a fresh baseline, so changes during the gap will not generate notifications. State lives outside the checkout in `~/.local/share/t3poll` by default.

Automatically created credentials last 30 days. t3poll replaces them on use during their last day or after expiration, including from the background worker. Explicitly supplied token files remain your responsibility.

## Development

```sh
npm ci
npm test
npm run check
```

See [compatibility and test evidence](docs/compatibility.md) and the [future webhooks decision](docs/webhooks.md).

## License

Licensed under the [MIT License](LICENSE).
