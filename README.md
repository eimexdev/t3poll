# t3poll

Watch a GitHub PR and wake an existing T3 Code conversation when something changes.

Three MCP tools: `watch`, `list`, and `stop`. The same operations are available from the CLI. Calling `watch` starts a background worker automatically. It polls every 60 seconds without invoking a model, sends a short notification through T3 when something changes, and exits when there is nothing left to watch.

The agent uses its existing GitHub tools to read comments and logs. No skill is required.

Implementation is in progress. Setup and verified compatibility will be documented here before release. See [the webhook decision](docs/webhooks.md) for the optional future push-based approach.
