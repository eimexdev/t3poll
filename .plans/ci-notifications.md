# Notify on useful CI milestones

Status: planned, not implemented. This expands the CI portion of [notification noise follow-up](update-freshness-and-notification-noise.md).

## Problem

Completed individual checks currently enter the change stream. Linux, macOS, and Windows finishing in different polls can produce separate wakeups even though the agent still needs to wait. Checks finishing within one poll are normally grouped. Queued and running checks do not directly notify, but bot summary edits can produce separate activity.

The current snapshot omits unfinished checks from its notification entries. Completion aggregation must retain enough pending state to distinguish partial success from a finished CI cycle; it cannot infer completion just from the existing completed entries.

## Intended default

- Notify promptly when a check newly fails, allowing investigation while other checks run.
- Stay quiet when an individual check succeeds while others remain unfinished.
- Send one completion summary for the current commit and CI cycle when its checks finish, including failures if present.
- Group failures observed together and avoid repeated alerts for an unchanged failure.
- On a new head commit, invalidate unsent CI summaries from the previous head and begin tracking the new head. Keep unrelated review feedback. Do not replace an already submitted or frozen delivery command, whose IDs must remain stable for retries.
- Treat reviews separately: new findings and completed reviews can notify while CI is running. Suppress routine bot progress edits through the separate notification-filtering work.

The useful milestones are a newly actionable failure, CI completion, and review feedback or completion. This plan does not make CI completion equivalent to permission to merge.

## Design decisions to settle

1. Define the completion boundary. Track queued, running, waiting, and terminal checks and commit statuses. Determine how to handle checks registered late, dependent jobs, required checks that have not appeared, and workflow approval gates. No observed checks must not mean all CI passed. Consider a short settling period or workflow-run completion evidence; describe the limits of the chosen boundary.
2. Define a CI cycle and rerun identity. A rerun on the same commit must invalidate a previously complete cycle and be able to emit a new completion. Distinguish separate workflows and duplicate job names instead of relying only on check app/name. Account for repositories running both push and pull-request workflows.
3. Define outcomes. Explicitly classify failures, timeouts, action-required states, cancellation, neutral results, and skipped jobs. A completed but unsuccessful cycle must not be described as all green. Decide whether recovery deserves a separate alert or belongs in the completion summary.
4. Choose a small failure batching window and completion settling rule. Avoid repeatedly postponing an actionable failure while new events arrive. Keep polling frequency separate from delivery policy.
5. Deduplicate semantic outcomes rather than treating every new run ID as new feedback. A real regression after recovery must still notify. Decide how much unchanged failure information a rerun summary needs.
6. Preserve pending-state correctness across restart, worker handoff, a busy destination, and a new commit. Reuse the existing frozen command/message IDs for ambiguous deliveries. Revalidate unsent CI summaries before dispatch.
7. Use short controlled reasons such as "Windows CI failed" or "CI finished: 5 passed, 1 failed". Do not copy arbitrary bot or comment text into agent wakeups. Consider bounded diagnostic history so each delivery can be traced to its triggering milestones.

## Acceptance cases

- Staggered Linux, macOS, and Windows successes produce one completion notification.
- An early failure notifies while other checks are running; final completion does not masquerade as a new failure.
- Several failures in the batching window produce one wakeup, and unchanged polls produce none.
- Recovery followed by a new failure is not suppressed as a duplicate.
- A rerun on the same SHA starts a new cycle; old successful results do not prematurely satisfy it.
- Late jobs, approval-gated workflows, pending commit statuses, and an empty check set do not produce premature success.
- Duplicate job names across workflows and push/PR runs are handled deliberately.
- A new commit removes stale unsent CI summaries without losing review feedback or changing frozen delivery IDs.
- Restart and version handoff preserve aggregation and deduplication state.
- New review findings and a review completed without findings remain observable independently of CI.

Validate the policy against a recorded or simulated babysitting sequence with multiple platforms, reruns, head changes, and bot summary edits. Compare wakeup count and time to first actionable failure with today's behavior before choosing defaults.
