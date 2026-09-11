# Compatibility

t3poll targets the authenticated orchestration API in stock T3 Code v0.0.40. It reads `/api/orchestration/shell` and posts `thread.turn.start` to `/api/orchestration/dispatch`. No fork, database integration, or direct access to T3's Codex child process is required.

Verified September 11, 2026 on Node 24.21.0 and Linux: the stock-release proof passed with T3 0.0.40 and a scripted Codex provider. MCP disconnected before delivery; T3 recorded the notification, invoked the provider, completed the turn, and deduplicated a repeated command. A separate read-only GitHub smoke check parsed reviews, comments, and checks from a public upstream PR. No live T3 server or real model session was used.

Supported platforms are Windows x64, macOS, and Linux with Node.js 24.10+. The implementation uses Node's built-in SQLite, the MCP SDK, and Zod. It does not require Effect or a database server. MCP uses ordinary stdio tools; Tasks and unsolicited MCP wakeups are not dependencies.

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

Unit/process tests additionally cover simultaneous first use across processes, expired credential replacement, failed issuance/verification preserving the token, stale process state, ambiguous instances, and manual credential overrides. Discovery supports Linux `/proc`, macOS native process inspection, and Windows x64 native process inspection for installed T3 `dist/bin.mjs` processes with `userdata` runtime state. Packaged Windows x64 and macOS desktop apps use their bundled Electron runtime for credential issuance and renewal. Other layouts retain the manual connection path.

## macOS verification

Verified September 11, 2026 on Apple Silicon with Node 24.21.0 and T3 Code Nightly `0.0.41-nightly.20260910.1507`. All 30 automated tests pass, including process discovery, paths containing spaces, symlinks, credential renewal, and worker survival after MCP exit. CI runs the suite on Ubuntu, macOS, and Windows. Intel Macs have not been tested locally.

A read-only check of a running desktop installation discovered its server without connection overrides, issued a managed credential, and listed 142 threads through both the service and a real stdio MCP client. The MCP client exposed `watch`, `list`, and `stop`. The live installation had no watches, and no messages or watches were created there.

The isolated stock proof passed against the same packaged app. It verified initial credential issuance, renewal from the detached worker, delivery after MCP disconnected, another delivery during a running scripted provider turn, turn completion, and command deduplication. No model calls were made. The proof pins the scripted provider's executable and environment because desktop startup can replace the inherited PATH.

The stock proof also accepts a packaged macOS app. Use the app's executable as `T3POLL_TEST_T3_RUNTIME` and its `Contents/Resources/app.asar/apps/server/dist/bin.mjs` as `T3POLL_TEST_T3_BIN`. The proof selects only its disposable T3 home, so another running installation cannot be selected by accident.

## Windows verification

Verified September 11, 2026 on Gideon, Windows 11 x64 build 26200, with Node 24.19.0. All 32 tests passed both over SSH and in a non-administrator interactive user context. Linux passes its 30 applicable tests; the two native Windows tests are skipped there.

The isolated stock proof passed against the npm-installed T3 CLI `0.0.40` and the installed T3 desktop `0.0.41-nightly.20260911.1551`, using disposable homes and a scripted provider. It verified automatic credentials, worker renewal, delivery after MCP disconnection, running-turn steering, and command deduplication. Real Codex CLI `0.154.0` separately verified disabled-by-default MCP tools and the T3 launch override without model calls. The npm tarball installed in a Windows directory containing spaces and non-ASCII characters and passed the npm T3 and real Codex proofs. User T3/Codex configurations and conversations were not changed.

Windows x64 support uses native process inspection and Windows ACLs through the existing Koffi dependency. Process inspection checks the token owner before reading parameters. It bounds remote reads and rejects inaccessible or unsupported processes. The x64 PEB/process-parameter layout is internal to Windows and may change; failures stop automatic discovery rather than falling back to trusting the runtime file. Windows ARM64 and 32-bit Node are not supported by this implementation.

Packaged desktop discovery recognizes both `app.asar` and `server.asar`. Windows Restart Manager verifies that the selected process has that home's database open before t3poll invokes its auth CLI. Managed state and credentials receive protected current-user ACLs. Token reads reject grants to other users, while allowing SYSTEM and Administrators. This also works from an elevated account whose files default to Administrators ownership.

Native test fixtures use .NET console executables rather than Unix shebangs. Their child processes are contained in Windows jobs so test cleanup cannot leave scripted providers running. These fixtures require the Windows .NET Framework C# compiler; the installed t3poll package does not.

To run the isolated stock proof in PowerShell against a packaged app:

```powershell
$env:T3POLL_TEST_T3_RUNTIME = "$env:LOCALAPPDATA/Programs/t3code/T3 Code (Nightly).exe"
$env:T3POLL_TEST_T3_BIN = "$env:LOCALAPPDATA/Programs/t3code/resources/server.asar/apps/server/dist/bin.mjs"
node scripts/prove-t3.mjs
```

For an npm-installed T3 CLI, set only `T3POLL_TEST_T3_BIN` to its `dist/bin.mjs`. To check real Codex tool scoping without a model call, set `T3POLL_TEST_CODEX_BIN` to the installed native `codex.exe` and run `node scripts/prove-codex.mjs`. This creates a disposable Codex home, verifies no t3poll tools are exposed by default, then verifies `list`, `stop`, and `watch` with `-c mcp_servers.t3poll.enabled=true`. It does not edit the user's Codex or T3 configuration. Both proof scripts accept `T3POLL_TEST_CLI` to exercise a separately installed tarball's `dist/cli.js` instead of the checkout build.
