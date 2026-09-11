# Monitoring behavior

## What the agent receives

```text
[t3poll] New activity on https://github.com/owner/repo/pull/123
Watch: <ID>. Head: <commit>.

- Comment 456 was added or updated.
  https://github.com/owner/repo/pull/123#issuecomment-456
- Check "tests": failure.
  https://github.com/owner/repo/actions/runs/789

Inspect the changes with your existing GitHub tools and continue
the assigned task under this thread's existing permissions.
```

Comment bodies and CI logs are not copied into the message. The agent fetches what it needs. t3poll does not merge, push, approve, or post comments.

## Polling and lifetime

An optional CLI `--interval 30`, or MCP `intervalSeconds: 30`, changes the poll interval. The default is 60 seconds; the accepted range is 15–3600 seconds. Repeating `watch` for the same PR and destination returns the existing watch without changing its interval or expiration. Stop and watch again to reset it.

## Delivery and recovery

- The first read establishes a baseline. Existing feedback does not cause a notification.
- New or edited comments/reviews, terminal CI results, head commits, and closure/merge are detected. Check reruns and legacy commit statuses are included; queued/running checks stay quiet.
- Changes found in one poll become one notification. Changes accumulate while the destination is busy or awaiting input/approval.
- Watches finish after the final closure/merge notification, stop on request, or expire after 24 hours. Expiration cancels remaining unsent work.
- T3/GitHub failures retry with backoff. `list` shows polling and delivery errors. A timed-out dispatch retains the same command and message IDs for retry.
- `lastDelivery` means T3 accepted the command. It does **not** mean the agent completed the work. Provider failures remain in T3; t3poll does not blindly send the message again.
- Stopping cancels unsent work. An HTTP request already in flight may still be accepted and run.
- There is no startup service. After a reboot or worker crash, calling `watch` or `list` restarts saved active watches. The machine must be awake and T3 available for delivery.

State lives in `~/.local/share/t3poll`, or `T3POLL_HOME`. All clients using the same directory share one worker. Keep that directory private. The worker writes startup/crash diagnostics to `worker.log`; ordinary unchanged polls are silent.

See [compatibility and limitations](compatibility.md) and [why polling comes before webhooks](webhooks.md).

## Busy threads

GitHub polling continues every 60 seconds by default. When there is a notification to deliver, a busy thread or one awaiting approval/input is checked again every 15 seconds. Changes accumulate and are combined into a normal message when the thread becomes idle. t3poll sends no steering or interrupt command. A watch still expires after 24 hours, including any unsent notifications.

The idle check and message submission are separate requests. A user can start a turn between them; see the [compatibility limits](compatibility.md#boundaries).
