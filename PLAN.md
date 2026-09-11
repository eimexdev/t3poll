# t3poll

An MCP server with three tools: `watch`, `list`, and `stop`. Matching CLI commands use the same implementation. No skill is required.

1. The agent calls `watch` with a PR URL and an explicit T3 thread ID.
2. Registration starts a detached worker automatically and returns.
3. The worker checks GitHub every 60 seconds without invoking the model.
4. Changes produce a short T3 message with links. The agent reads the comments and logs using its existing tools.
5. The worker exits when no watches or pending deliveries remain.

Save watches and pending messages, prevent duplicate delivery, wait for busy threads, and retry temporary failures. Watches end on merge/closure, cancellation, or after 24 hours. A later `watch` or `list` restarts saved watches after a worker crash or reboot.

TypeScript, Node's built-in SQLite, the MCP SDK, and Zod. No Effect dependency or system service installation.

Polling is the first implementation because it needs no public receiver or repository webhook permissions. [Optional webhooks](docs/webhooks.md) can feed the same change handler later.

The implementation and isolated stock-T3 proof are complete. See [setup](README.md) and [compatibility](docs/compatibility.md). Live configuration remains a separate action; the existing running T3 server has not been modified.
