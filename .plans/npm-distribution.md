# npm distribution and MCP launch

Status: release infrastructure implemented after installer and platform verification. See [release operations](../docs/releases.md) for nightly publication, trusted publishing, and stable promotion. Worker handoff is implemented; see [update behavior](../docs/updates.md).

## Intended experience

Users register MCP without cloning a repository, choosing a code directory, or building TypeScript. Once a package is published, the launch entry can use:

```text
npx --yes t3poll@latest mcp
```

This is a proposed invocation. Confirm the available npm package name and publishing account first; use a scope if needed. Follow [T3-only registration](t3-only-mcp.md) when configuring Codex.

`@latest` follows stable releases when MCP launches, using npm's normal cache behavior. Offer `@nightly` as an explicit opt-in and preserve the selected channel. Ordinary installations should follow their channel rather than pinning the version used for setup. An explicit version can remain a troubleshooting option.

Publish nightly builds automatically after checks. Trigger stable publication manually from a commit already shipped on nightly, following T3 Code's manual promotion approach. A channel change does not update an already-running MCP process or detached worker. Include [worker updates](worker-updates.md) in the release work so active monitoring survives version handoff.

## Work

The repository already has a CLI bin entry, compiled-file packaging, and a prepack build. Inspect the current package contents, test installation from a tarball on a clean supported machine, then configure npm publishing and a repeatable release workflow. Preserve the existing Node requirement unless deliberately changing and testing it.

Initial publication needs an npm account and control of the chosen name. GitHub Actions trusted publishing is a possible follow-up. Do not make publication part of a test run.

## Done when

A clean installation exposes the same three MCP tools and automatic setup works without a checkout. Documentation explains startup-time updates, graceful worker handoff, and compatibility limits.

References: [npm execution and cache behavior](https://docs.npmjs.com/cli/npm-exec/), [publishing public scoped packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).
