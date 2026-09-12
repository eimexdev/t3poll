# Update freshness and notification noise

Status: startup cache simplification approved and implemented after release 0.1.1. Notification changes remain deferred proposals.

## Startup update checks

The installer currently registers the equivalent of:

```sh
npx --yes t3poll@latest mcp
```

Nightly installations use `@nightly`. The actual configuration invokes Node and npm by absolute path for reliable launching across platforms. `list` is a manual way to load a channel and initiate worker handoff; it is not the registered MCP command.

`--yes` suppresses npm's package-install confirmation. It does not force a fresh download or answer the setup wizard's questions. `--prefer-online` forces cache freshness checks even when npm would otherwise reuse cached information. Existing MCP processes do not periodically query the registry.

Decision: remove `--prefer-online` from newly generated MCP commands and accept npm's default cache behavior. Keep following the selected release channel. Existing launch configurations retain the flag until setup is rerun. Explicit manual update commands can still use `--prefer-online`.

A possible later alternative is a bounded check interval with a working cached runtime as fallback. Decide the freshness interval and offline behavior before implementing that alternative.

Reference: [npm exec flags and caching](https://docs.npmjs.com/cli/v11/commands/npm-exec/).

## Notification observations

During PR #7 babysitting, several wakeups only revealed another successful platform check while Windows or code review was still pending. The wakeup that exposed the candidate handoff timeout was useful and led to a fix. Review completion, including completion without findings, is useful for deciding when to merge. A notification already submitted to T3 can still arrive after the watch is stopped.

Current sources of noise in `src/github.ts` and `src/model.ts`:

- Any change to a bot comment's body counts, including summary timestamps, run IDs, and review-started or review-running edits.
- Our own pushes generate head-change notifications.
- Check fingerprints include run IDs, so another run can generate activity even when its conclusion is unchanged. CI currently runs for both pushes and pull requests; consider their overlap when evaluating duplicate results.
- Each wakeup says only "New activity", requiring a GitHub fetch to determine whether action is needed.

Resolving a review thread does not directly trigger a notification because resolution state is not tracked. A subsequent bot-comment edit could trigger one indirectly.

The store retains the current snapshot and latest delivery, not a full record of the changes behind each notification. The discussion assessed observed wakeups; it was not an exact historical audit of every trigger.

## Proposed follow-up

1. Notify promptly about new feedback and newly failing checks.
2. Aggregate successful checks into a useful completion notification instead of waking the agent for every platform. See [CI notification milestones](ci-notifications.md) for the proposed policy, unresolved completion rules, and acceptance cases.
3. Preserve review-completion notifications, including reviews with no findings, while suppressing routine running-status edits. Distinguish meaningful edited feedback from bot summary churn.
4. Include a short, controlled reason such as "New review finding" or "All CI checks passed". Avoid copying arbitrary comment bodies into wakeups.
5. Consider short batching windows and deduplication for related review comments, review submissions, summary edits, and repeated check outcomes.
6. Evaluate whether self-originated pushes need a wakeup. Do not blanket-ignore bots or all activity from the authenticated GitHub account, since both can contain useful feedback.
7. Consider bounded diagnostic history recording trigger types and delivery IDs, so future notification audits can identify why each wakeup happened without retaining credentials or full comment bodies.

Preserve failures, meaningful feedback edits, completed reviews, and merge/closure notifications while reducing wakeups that cannot change the agent's next action. Measure the result against a babysitting session with multiple platforms, reruns, and bot summary edits before choosing defaults.
