# Why polling first

Decision: start with a 60-second GitHub poll. Add optional webhooks later if faster updates justify the setup.

Polling asks GitHub whether anything changed. It uses the existing `gh` login, needs no inbound connection, and can monitor PRs in repositories the user can read.

Webhooks let GitHub tell us immediately. They need a reachable HTTPS receiver or relay, configuration for each repository or a GitHub App, and appropriate permissions. Creating a repository webhook requires owner/admin access. A PR contributor may not have that access. GitHub cannot deliver directly to localhost.

For a local tool, polling makes installation simpler. Unchanged polls run ordinary code and do not call the model. The tradeoff is detection latency of roughly one polling interval plus request time.

## If we add webhooks

Keep the MCP tools and T3 delivery unchanged. A verified webhook schedules a fresh GitHub read, and the existing snapshot comparison detects changes. Treat the payload as a hint rather than a second source of truth.

- Offer an explicit webhook mode for configured repositories; use polling elsewhere.
- Verify webhook signatures and deduplicate delivery IDs.
- Subscribe to reviews, review comments, issue comments, PR updates, check runs, and commit statuses as appropriate.
- Keep occasional reconciliation polls for missed deliveries and downtime.
- Decide between a user-provided receiver, a relay, and a hosted GitHub App before implementation. A relay also introduces a privacy and availability dependency.

Webhooks reduce GitHub polling but do not remove the need for something running to receive and deliver events.

Sources checked September 11, 2026: [creating GitHub webhooks](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks), [localhost limitations](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks), and [validating deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
