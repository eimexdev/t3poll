# Compatibility

t3poll targets the authenticated orchestration API in stock T3 Code v0.0.40. It reads `/api/orchestration/shell` and posts `thread.turn.start` to `/api/orchestration/dispatch`. No fork, database integration, or direct access to T3's Codex child process is required.

Verified September 11, 2026 on Node 24.21.0 and Linux: the stock-release proof passed with T3 0.0.40 and a scripted Codex provider. MCP disconnected before delivery; T3 recorded the notification, invoked the provider, completed the turn, and deduplicated a repeated command. A separate read-only GitHub smoke check parsed reviews, comments, and checks from a public upstream PR. No live T3 server or real model session was used.

The initial platform is Linux with Node.js 24.10+. The implementation uses Node's built-in SQLite, the MCP SDK, and Zod. It does not require Effect or a database server. MCP uses ordinary stdio tools; Tasks and unsolicited MCP wakeups are not dependencies.

## Boundaries

- T3's interface is a released client API, not a promised stable extension SDK. Unexpected shell shapes and unknown runtime states block delivery. New releases need a compatibility check.
- The initial GitHub reader supports `github.com` PR URLs. GitHub Enterprise hosts are not implemented.
- Each watch polls independently. A poll normally uses six GitHub requests, plus pagination. Large watch counts or large PR histories can hit rate limits; failures back off. Shared-PR caching is a possible later optimization.
- The first snapshot is the baseline. t3poll detects changes observable at polling time; a comment created and deleted between polls may never be seen.
- Running threads accept notifications through `thread.turn.start`, which T3 forwards to Codex `turn/start`. Codex 0.153.2 steers the active turn through this operation. Other providers/versions follow their own input semantics. Startup, approval/input prompts, and unknown/error states hold delivery. Special operations such as review or compaction may reject steering; an accepted T3 command does not guarantee provider acceptance.
- Ambiguous dispatch retries reuse the exact command. They may reach a now-busy thread; T3's command receipt deduplication prevents a previously accepted command being appended twice.
- Acceptance is the delivery acknowledgement. There is no claim of exactly-once model execution, provider completion tracking, or automatic recovery of failed agent work.
- A detached process survives ordinary MCP/CLI exit. OS session policies, containers, suspend, logout, or parent cgroup cleanup can still stop it. A later `watch` or `list` restarts it; no watchdog or login service is installed.
- `stop` does not interrupt accepted turns. A request already in flight can complete after cancellation.

## Stock release proof

Install stock T3 in a disposable directory, outside this repository. Build its native dependencies if required by that release. Then run:

```sh
npm run build
T3POLL_TEST_T3_BIN=/absolute/path/to/isolated/node_modules/t3/dist/bin.mjs node scripts/prove-t3.mjs
```

The script creates a fresh T3 home, credential, project, and thread. It supplies a scripted Codex executable and fake GitHub responses, registers a watch through the real MCP transport, disconnects MCP, and changes the GitHub fixture. It checks the T3 message, provider invocation, turn completion, and duplicate-command receipt. It shuts down only its own processes and removes its temporary state.

The regular process test separately verifies MCP tool discovery, duplicate registration, worker survival, busy-thread buffering, CLI cancellation, and worker exit. Core tests cover retry IDs across database reopening, polling failures, expiry, pagination, reruns, and cancellation races.

This proves the protocol and process flow without spending model tokens. It does not replace a separately authorized test in a user's live thread.

## Sources

- [T3 v0.0.40 HTTP contracts](https://github.com/pingdotgg/t3code/blob/v0.0.40/packages/contracts/src/environmentHttp.ts)
- [Turn command and thread schemas](https://github.com/pingdotgg/t3code/blob/v0.0.40/packages/contracts/src/orchestration.ts)
- [T3 headless credential issuance](https://github.com/pingdotgg/t3code/blob/v0.0.40/apps/server/src/cli/auth.ts)
- [T3 command receipt handling](https://github.com/pingdotgg/t3code/blob/v0.0.40/apps/server/src/orchestration/Layers/OrchestrationEngine.ts)

## Steering evidence

[Codex 0.153.2's active-turn test](https://github.com/openai/codex/blob/rust-v0.153.2/codex-rs/app-server/tests/suite/v2/turn_start.rs) includes `turn_start_steers_active_turn_and_returns_active_turn_id`. T3's `CodexSessionRuntime.sendTurn` forwards normal message commands to that operation. The isolated proof also sends a second update while its scripted provider is running. That verifies T3 forwarding; the upstream Codex test establishes same-turn semantics.

## Automatic setup

Tested against an isolated copy of T3 `0.0.41-nightly.20260910.1507` on Linux. The proof starts MCP without URL/token configuration, discovers the instance, creates and verifies its credential, and forces credential renewal from the detached worker before a second delivery. A fresh CLI process then reuses the connection. No running user server or real model is used.

Unit/process tests additionally cover simultaneous first use across processes, expired credential replacement, failed issuance/verification preserving the token, stale process state, ambiguous instances, and manual credential overrides. Discovery requires Linux `/proc` and an installed T3 `dist/bin.mjs` process with `userdata` runtime state. Other layouts retain the manual connection path.
