# t3poll follow-up plans

Handoff from the September 11, 2026 discussion. These are small implementation briefs, not requests to implement every item at once. The repository's default branch is `master`.

## Remaining work

- [Setup and release work order](setup-and-release.md): Windows validation first, a Codex-in-T3 setup wizard, automatic worker updates, and nightly/stable releases.
- [T3-only MCP registration](t3-only-mcp.md): keep the tools out of ordinary Codex sessions through configuration.
- [npm distribution](npm-distribution.md): install and launch without a source checkout. Publication was deferred until real-world testing is satisfactory.
- [Updates during monitoring](worker-updates.md): load new code while retaining active watches and pending deliveries.
- [Optional webhooks](webhooks.md): faster detection with polling fallback; a future option, not a prerequisite for release.

## Already implemented

[Automatic setup](automatic-setup.md) records what shipped in [PR #1](https://github.com/eimexdev/t3poll/pull/1), merged September 11. The earlier discussion listed discovery, credentials, and setup through MCP as unfinished; that list is now outdated.

MCP/CLI monitoring, automatic worker startup, 60-second polling, steering running threads, and short notifications are also implemented. No skill is required. The normal deployment is one t3poll installation alongside T3 on each machine.

## Working preferences

Keep the agent interface and documentation short. Prefer existing tools and configuration over new commands, services, or dependencies. Keep notifications to the PR link and a short request to check updates. Preserve running T3 servers and ongoing conversations while developing and testing. Inspect the destination machine's actual configuration; paths from another machine are not installation defaults.
