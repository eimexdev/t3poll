import { z } from "zod";
import { renewManaged } from "./setup.js";
import { readToken } from "./config.js";
import type { Command } from "./model.js";

const threadSchema = z.object({
  id: z.string(),
  title: z.string(),
  runtimeMode: z.enum([
    "approval-required",
    "auto-accept-edits",
    "auto",
    "full-access",
  ]),
  interactionMode: z.enum(["default", "plan"]),
  archivedAt: z.string().nullable(),
  deletedAt: z.string().nullable().optional(),
  latestTurn: z
    .object({ state: z.string(), completedAt: z.string().nullable() })
    .nullable(),
  session: z
    .object({
      status: z.string(),
      activeTurnId: z.string().nullable(),
      lastError: z.string().nullable().optional(),
    })
    .nullable(),
  hasPendingApprovals: z.boolean().optional(),
  hasPendingUserInput: z.boolean().optional(),
});
export type Thread = z.infer<typeof threadSchema>;

export function availability(thread: Thread): "ready" | "busy" | "blocked" {
  if (
    thread.deletedAt ||
    thread.archivedAt ||
    thread.session?.status === "error"
  )
    return "blocked";
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    ["starting", "connecting"].includes(thread.session?.status ?? "") ||
    (thread.latestTurn &&
      ["pending", "running"].includes(thread.latestTurn.state) &&
      thread.session?.status !== "running")
  )
    return "busy";
  // Unknown session/turn states must not be assumed idle on a new server release.
  if (
    thread.session &&
    ![
      "ready",
      "running",
      "idle",
      "interrupted",
      "stopped",
      "disconnected",
    ].includes(thread.session.status)
  )
    return "blocked";
  if (
    thread.latestTurn &&
    !["completed", "interrupted", "error", "pending", "running"].includes(
      thread.latestTurn.state,
    )
  )
    return "blocked";
  return "ready";
}

export class T3 {
  constructor(
    readonly origin: string,
    readonly tokenFile: string,
  ) {}
  async request(path: string, command?: Command): Promise<unknown> {
    await renewManaged(this.tokenFile, this.origin);
    const response = await fetch(`${this.origin}${path}`, {
      method: command ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${readToken(this.tokenFile)}`,
        ...(command ? { "Content-Type": "application/json" } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    }).catch(() => {
      throw new Error(
        "Cannot reach T3. Check T3POLL_URL and whether T3 is running.",
      );
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `T3 returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? "Check the credential and orchestration read/operate scopes." : "Check the destination and supported T3 version."}`,
      );
    }
    return response.json();
  }
  async threads(): Promise<Thread[]> {
    const payload = await this.request("/api/orchestration/shell");
    try {
      return z.object({ threads: z.array(threadSchema) }).parse(payload)
        .threads;
    } catch {
      throw new Error(
        "Unsupported T3 shell response. See docs/compatibility.md.",
      );
    }
  }
  async thread(id: string): Promise<Thread> {
    const thread = (await this.threads()).find((thread) => thread.id === id);
    if (!thread)
      throw new Error(
        "T3 thread not found. Call list with threads=true and choose an explicit thread ID.",
      );
    if (thread.archivedAt || thread.deletedAt)
      throw new Error(
        "Destination thread is archived or deleted. Choose an active thread.",
      );
    return thread;
  }
  async dispatch(command: Command): Promise<number> {
    const result = await this.request("/api/orchestration/dispatch", command);
    return z.object({ sequence: z.number().int().nonnegative() }).parse(result)
      .sequence;
  }
}
