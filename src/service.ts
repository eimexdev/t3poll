import { randomUUID } from "node:crypto";
import { connection, type Config } from "./config.js";
import { Store } from "./store.js";
import { T3 } from "./t3.js";
import { readGithub } from "./github.js";
import { parsePr, watchInput, type Watch, type WatchInput } from "./model.js";
import { ensureWorker } from "./worker.js";

function publicWatch(w: Watch) {
  return {
    id: w.id,
    pr: w.pr,
    threadId: w.threadId,
    threadTitle: w.threadTitle,
    status: w.status,
    intervalSeconds: w.intervalSeconds,
    lastPoll: w.lastPoll ? new Date(w.lastPoll).toISOString() : null,
    expiresAt: new Date(w.expiresAt).toISOString(),
    pendingChanges: w.pending.length,
    pendingDelivery: w.command !== null,
    lastDelivery: w.lastDelivery,
    error: w.lastError,
    deliveryStatus: w.deliveryError,
  };
}

export class Service {
  readonly store: Store;
  constructor(readonly config: Config) {
    this.store = new Store(config.home);
  }
  async watch(raw: WatchInput) {
    const input = watchInput.parse(raw);
    const pr = parsePr(input.pr).url;
    const threadId = input.threadId ?? this.config.threadId;
    if (!threadId)
      throw new Error(
        "Choose the destination threadId explicitly. Call list with threads=true to see T3 threads.",
      );
    const { origin, tokenFile } = connection(this.config);
    const key = JSON.stringify([origin, threadId, pr.toLowerCase()]);
    let watch = this.store.all().find((watch) => watch.key === key);
    if (watch && ["watching", "finishing"].includes(watch.status)) {
      const worker = await ensureWorker(this.store);
      return {
        ...publicWatch(watch),
        worker,
        message: "Already watching this PR in that T3 thread.",
      };
    }
    const [thread, snapshot] = await Promise.all([
      new T3(origin, tokenFile).thread(threadId),
      readGithub(pr),
    ]);
    if (snapshot.state !== "open")
      throw new Error(
        `PR is already ${snapshot.state}; there is nothing to watch.`,
      );
    const now = Date.now();
    const next: Watch = {
      id: watch?.id ?? randomUUID(),
      key,
      revision: watch?.revision ?? 0,
      pr,
      threadId,
      threadTitle: thread.title,
      origin,
      tokenFile,
      intervalSeconds: input.intervalSeconds,
      status: "watching",
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      nextPoll: now + input.intervalSeconds * 1000,
      lastPoll: now,
      snapshot,
      pending: [],
      command: null,
      nextDelivery: now,
      pollFailures: 0,
      deliveryFailures: 0,
      lastError: null,
      deliveryError: null,
      lastDelivery: null,
    };
    if (watch) {
      if (!this.store.save(next))
        throw new Error("Watch changed during registration. Retry watch.");
      watch = next;
    } else {
      watch = this.store.add(next);
    }
    const worker = await ensureWorker(this.store);
    return {
      ...publicWatch(watch),
      worker,
      message: `Watching for new changes every ${watch.intervalSeconds} seconds. Existing feedback is the baseline. Notifications go to T3 thread ${watch.threadId}; inspect comments and logs using your existing GitHub tools.`,
    };
  }
  async list(includeThreads = false) {
    // Status remains inspectable even when a broken installation cannot start a worker.
    const worker = await ensureWorker(this.store).catch((error: unknown) => ({
      pid: null,
      error: error instanceof Error ? error.message : "Worker startup failed.",
    }));
    const watches = this.store.all().map(publicWatch);
    const threads = includeThreads
      ? (
          await new T3(
            connection(this.config).origin,
            connection(this.config).tokenFile,
          ).threads()
        )
          .filter((t) => !t.archivedAt && !t.deletedAt)
          .map((t) => ({ id: t.id, title: t.title }))
      : undefined;
    return { watches, worker, ...(threads ? { threads } : {}) };
  }
  stop(id: string) {
    return {
      ...publicWatch(this.store.stop(id)),
      message:
        "Watch stopped. No further updates will be sent. A notification already submitted to T3 may still run.",
    };
  }
  close() {
    this.store.close();
  }
}
