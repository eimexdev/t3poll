# Scope MCP to T3-launched Codex sessions

Status: proposed; not configured or implemented by this plan.

## Problem

The original installation registered t3poll globally in Codex. Ordinary Codex sessions can therefore see it. They can control watches, but notifications go to a T3 conversation, not back to the ordinary Codex session. Hide the tools there to avoid that confusion.

## Proposed approach

Keep the MCP entry in shared Codex configuration with `enabled = false`. In T3's Codex provider **Launch arguments**, add:

```text
-c mcp_servers.t3poll.enabled=true
```

Preserve other launch arguments and configuration. T3 already supports launch arguments; no T3 source change should be necessary. This controls tool availability, not security isolation. A separate T3-specific `CODEX_HOME` is an alternative, but adds configuration management.

## Implementation and verification

Confirm the destination machine's T3 version supports `launchArgs` and that its Codex version applies the override. Check for an existing `T3CODE_CODEX_LAUNCH_ARGS` environment override, which can take precedence over the provider setting. Update installation guidance so a new setup uses this scope by default.

Verify a fresh ordinary Codex session has no t3poll tools, while a fresh T3-launched session exposes `watch`, `list`, and `stop` and can list T3 threads. Keep running sessions intact while testing; they may retain their existing tool catalog.

Source inspected in the local T3 checkout: `packages/contracts/src/settings.ts` defines Codex `launchArgs`; `apps/server/src/provider/Layers/codexLaunchArgs.ts` passes them to `codex app-server`. The installed `0.0.41-nightly.20260910.1507` bundle also contained this setting. Verify again on the target machine.
