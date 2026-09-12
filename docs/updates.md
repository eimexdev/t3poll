# Updates

Setup follows the invoked package's channel. New Codex sessions run npm with `--prefer-online` to resolve `latest` or `nightly`. Publishing alone does not change a running session. To load a channel now and hand over active watches, run:

```sh
npx --yes --prefer-online t3poll@nightly list
```

Use `@latest` for stable. The command reports the worker PID and version. `updating: true` means the current operation is still draining. MCP startup also resumes saved watches and checks every 30 seconds for missing workers. These checks use the installed runtime; they do not query npm.

## Handoff

A candidate starts from a separate installed package and opens the state database before advertising its version. The current worker finishes its watch operation, including any in-flight request and persistence, then releases its lease. The candidate acquires the lease before processing watches. No process signal is needed, including on Windows.

Watch IDs, expiration, snapshots, pending changes, and frozen commands stay in SQLite. An ambiguous dispatch retains exactly the same command and message IDs for retry. This relies on T3's existing command deduplication, just as ordinary network retries do.

The state directory remembers the newest successfully loaded runtime's version and executable paths. Older sessions reuse that runtime even after an idle period. Version ordering follows release triples and nightly timestamps; a stable version follows nightlies with the same base. Switching channels does not downgrade a shared worker. Wait for a later release on the selected channel to advance it. Local builds with the same version do not trigger handoff.

## Failures and compatibility

A failed download or candidate that cannot load leaves the current worker alone. An incompatible database version fails before the candidate advertises itself. State schema version 1 is preserved with additive coordination tables, so this release does not rewrite watch records.

If a candidate crashes after advertising readiness, saved watches remain intact. An attached MCP session retries worker startup within 30 seconds, or `list` retries immediately. Without an attached session, a failed successor may leave monitoring paused until the next command. Candidate lease acquisition waits up to 90 seconds. An in-flight operation is never killed to meet that deadline.

Keep the remembered package files installed while using that state directory. If npm's cache is manually cleared, run the same or a newer package again to restore a usable runtime. A runtime error appears in `list`; inspect `worker.log` under `T3POLL_HOME` for details.
