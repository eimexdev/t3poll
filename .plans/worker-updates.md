# Update code while retaining watches

Status: discussed, not implemented. No handoff design has been selected.

## Problem

A running worker retains its loaded code after a rebuild or MCP reconnect. Current instructions recommend updating between watches. Stopping and re-registering a watch creates a new baseline and can miss activity during the gap.

## Desired behavior

When new code takes over, preserve watch IDs, expiration, snapshots, pending changes, and frozen dispatch commands. An upgrade must not replay old feedback, submit a pending message twice, or run two workers for the same state directory.

## Suggested starting point

Inspect `src/worker.ts` and `src/store.ts`. They already coordinate a single worker using a lease and persist watch state. Consider recording a worker version and handing over after the current operation finishes. Keep retries on the exact persisted command/message IDs.

Do not add a permanent supervisor just for upgrades. Decide how a new MCP process requests a handoff, how an old MCP process avoids replacing a newer worker, and how incompatible stored-state versions are handled before choosing a mechanism.

## Done when

A process test upgrades a worker with an active watch and pending delivery, preserves the baseline, and verifies only one worker owns delivery. Include failed startup and an in-flight dispatch. Update README guidance once this works. npm startup-time updates alone do not satisfy this plan.
