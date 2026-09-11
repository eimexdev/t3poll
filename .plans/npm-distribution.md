# npm distribution and MCP launch

Status: deferred until real-world testing is satisfactory. Nothing has been published by this plan.

## Intended experience

Users register MCP without cloning a repository, choosing a code directory, or building TypeScript. Once a package is published, the launch entry can use:

```text
npx --yes --prefer-online t3poll@latest mcp
```

This is a proposed invocation. Confirm the available npm package name and publishing account first; use a scope if needed. Follow [T3-only registration](t3-only-mcp.md) when configuring Codex.

`@latest` with an online check picks up releases when MCP launches. It does not update an already-running MCP process or detached worker. An explicit version can provide a fixed installation. See [worker updates](worker-updates.md) for active monitoring.

## Work

The repository already has a CLI bin entry, compiled-file packaging, and a prepack build. Inspect the current package contents, test installation from a tarball on a clean supported machine, then configure npm publishing and a repeatable release workflow. Preserve the existing Node requirement unless deliberately changing and testing it.

Initial publication needs an npm account and control of the chosen name. GitHub Actions trusted publishing is a possible follow-up. Do not make publication part of a test run.

## Done when

A clean installation exposes the same three MCP tools and automatic setup works without a checkout. Documentation explains startup-time updates and the remaining worker limitation without claiming hot updates.

References: [npm execution and cache behavior](https://docs.npmjs.com/cli/npm-exec/), [publishing public scoped packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).
