import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "./store.js";
import { readGithub } from "./github.js";
import { T3, availability, type Thread } from "./t3.js";
import {
  backoff,
  changesBetween,
  mergeChanges,
  notification,
  type Watch,
  type Snapshot,
  type Command,
} from "./model.js";

export type Dependencies = {
  now: () => number;
  github: (pr: string) => Promise<Snapshot>;
  thread: (watch: Watch) => Promise<Thread>;
  dispatch: (watch: Watch, command: Command) => Promise<number>;
};
export const dependencies: Dependencies = {
  now: Date.now,
  github: readGithub,
  thread: (watch) =>
    new T3(watch.origin, watch.tokenFile).thread(watch.threadId),
  dispatch: (watch, command) =>
    new T3(watch.origin, watch.tokenFile).dispatch(command),
};
const message = (error: unknown): string =>
  error instanceof Error
    ? error.message.slice(0, 350)
    : "Unexpected operation failure.";

/** One watch cycle. All network work is outside SQLite transactions. Revision checks honor concurrent stop calls. */
export async function tick(
  store: Store,
  id: string,
  deps = dependencies,
  owns = () => true,
): Promise<void> {
  const watch = store.get(id);
  if (!watch || !["watching", "finishing"].includes(watch.status) || !owns())
    return;
  if (deps.now() >= watch.expiresAt) {
    watch.status = "expired";
    watch.pending = [];
    watch.command = null;
    store.save(watch);
    return;
  }
  if (watch.status === "watching" && deps.now() >= watch.nextPoll) {
    try {
      const snapshot = await deps.github(watch.pr);
      if (!owns()) return;
      if (watch.snapshot) {
        // Pending check results can become stale during a busy turn or after a new head.
        const pendingKeys = new Set(watch.pending.map((change) => change.key));
        watch.pending = watch.pending.filter(
          (change) => !/^(check|status):/.test(change.key),
        );
        const changes = changesBetween(watch.snapshot, snapshot, watch.pr);
        const retainedChecks = Object.entries(snapshot.entries)
          .filter(
            ([key, entry]) => entry.kind === "check" && pendingKeys.has(key),
          )
          .map(([key, entry]) => ({ key, text: entry.label, url: entry.url }));
        watch.pending = mergeChanges(watch.pending, [
          ...retainedChecks,
          ...changes,
        ]);
      }
      watch.snapshot = snapshot;
      watch.lastPoll = deps.now();
      watch.nextPoll = deps.now() + watch.intervalSeconds * 1000;
      watch.pollFailures = 0;
      watch.lastError = null;
      if (snapshot.state !== "open") watch.status = "finishing";
    } catch (error) {
      if (!owns()) return;
      watch.pollFailures++;
      watch.lastError = message(error);
      watch.nextPoll =
        deps.now() + backoff(watch.pollFailures, watch.intervalSeconds);
    }
    if (!store.save(watch)) return;
  }
  if (!watch.pending.length && !watch.command) {
    if (watch.status === "finishing") {
      watch.status = "completed";
      store.save(watch);
    }
    return;
  }
  if (deps.now() < watch.nextDelivery || !owns()) return;
  try {
    // An ambiguous request still keeps its IDs, but do not revive an archived destination.
    // A busy thread may be busy because this very command was accepted, so only the
    // first submission checks whether the thread can accept input below.
    if (watch.command) await deps.thread(watch);
    if (!watch.command) {
      const thread = await deps.thread(watch);
      if (!owns() || store.get(id)?.revision !== watch.revision) return;
      const state = availability(thread);
      if (state !== "ready") {
        watch.deliveryError =
          state === "busy"
            ? "Waiting for T3 startup or pending approval/input."
            : "T3 thread is blocked. Check its session, archive state, or pending work.";
        watch.nextDelivery = deps.now() + 15_000;
        store.save(watch);
        return;
      }
      watch.command = {
        type: "thread.turn.start",
        commandId: randomUUID(),
        threadId: watch.threadId,
        message: {
          messageId: randomUUID(),
          role: "user",
          text: notification(watch),
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: new Date(deps.now()).toISOString(),
      };
      watch.pending = [];
      // Freeze IDs and payload before sending. A timed-out request is retried byte-for-byte.
      if (!store.save(watch)) return;
    }
    if (!owns() || store.get(id)?.revision !== watch.revision) return;
    const sequence = await deps.dispatch(watch, watch.command);
    if (!owns()) return;
    watch.lastDelivery = {
      messageId: watch.command.message.messageId,
      acceptedAt: deps.now(),
      sequence,
    };
    watch.command = null;
    watch.deliveryError = null;
    watch.deliveryFailures = 0;
    watch.nextDelivery = deps.now() + 15_000;
    if (watch.status === "finishing" && !watch.pending.length)
      watch.status = "completed";
    store.save(watch);
  } catch (error) {
    if (!owns()) return;
    watch.deliveryFailures++;
    watch.deliveryError = message(error);
    watch.nextDelivery = deps.now() + backoff(watch.deliveryFailures);
    store.save(watch);
  }
}

export async function runWorker(home: string): Promise<void> {
  const store = new Store(home);
  const owner = randomUUID();
  if (!store.lease(owner, process.pid, Date.now())) {
    store.close();
    return;
  }
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const heartbeat = setInterval(() => {
    if (!store.lease(owner, process.pid, Date.now())) stopping = true;
  }, 5_000);
  try {
    while (!stopping && store.owns(owner)) {
      const work = store.work();
      if (!work.length && store.retire(owner)) break;
      for (const watch of work) {
        if (stopping) break;
        await tick(
          store,
          watch.id,
          dependencies,
          () => !stopping && store.owns(owner),
        );
      }
      if (!stopping) await delay(1000);
    }
  } finally {
    clearInterval(heartbeat);
    store.release(owner);
    store.close();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function ensureWorker(
  store: Store,
): Promise<{ pid: number | null }> {
  if (!store.work().length) return { pid: null };
  const previous = store.worker();
  if (previous && alive(previous.pid) && previous.expires > Date.now())
    return { pid: previous.pid };
  if (previous && !alive(previous.pid)) store.clearDeadWorker(previous.pid);
  const log = openSync(join(store.home, "worker.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./cli.js", import.meta.url)), "_worker"],
    {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      cwd: store.home,
      env: { ...process.env, T3POLL_HOME: store.home },
    },
  );
  closeSync(log);
  let spawnError = false;
  child.on("error", () => {
    spawnError = true;
  });
  child.unref();
  for (let i = 0; i < 80; i++) {
    if (spawnError) break;
    const worker = store.worker();
    if (worker && worker.expires > Date.now() && alive(worker.pid))
      return { pid: worker.pid };
    if (!store.work().length) return { pid: null };
    await delay(100);
  }
  throw new Error(
    "Watch saved, but worker startup failed. Run t3poll list to retry startup; inspect worker.log in T3POLL_HOME.",
  );
}
