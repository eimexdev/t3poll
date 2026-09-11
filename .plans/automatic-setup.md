# Automatic setup: completed work

Status: implemented and merged in [PR #1](https://github.com/eimexdev/t3poll/pull/1). Preserve this behavior; do not reimplement it from the older discussion.

Calling `watch` or `list` with `threads=true` discovers local T3 and creates a verified credential when needed. This implements setup through the existing MCP tools; no separate setup tool, CLI command, or skill was added. Initial MCP registration still happens outside the server.

Managed credentials last 30 days and renew on use within their final day or after expiration, including from the detached worker. Concurrent callers coordinate issuance. Failed proactive renewal retains a still-valid token and retries later. Invalid local token files are repaired. Newly issued sessions that fail verification are revoked, with persistent cleanup retry if revocation fails.

Discovery verifies the runtime file against the live process and supports package-manager executable symlinks. Multiple instances need an explicit selector. Manual token files remain user-managed.

At merge, automatic discovery supported Linux and installed T3 Node CLI processes using the `userdata` layout. Other layouts retained manual configuration. Check current code and other branches before assuming these platform limits still apply.

Implementation: `src/setup.ts`, `src/config.ts`, `src/service.ts`, and `src/t3.ts`. Regression tests are in `tests/setup.test.ts`; `scripts/prove-t3.mjs` tests an isolated real T3 installation with a scripted provider. See [setup instructions](../docs/setup.md) and [compatibility](../docs/compatibility.md).

The merged work passed 28 tests. The original machine's manually configured token was not automatically migrated into managed credentials. Inspect each machine's actual installation before changing it.
