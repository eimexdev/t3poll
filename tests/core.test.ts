import { makePublic } from "./fixtures/permissions.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/store.js";
import {
  parsePr,
  changesBetween,
  type Watch,
  type Snapshot,
  type Command,
} from "../src/model.js";
import { tick, type Dependencies } from "../src/worker.js";
import { availability, type Thread } from "../src/t3.js";
import { readGithub } from "../src/github.js";
import { readToken, validateOrigin } from "../src/config.js";

export const pr = "https://github.com/owner/repo/pull/1";
export const baseline: Snapshot = {
  head: "a".repeat(40),
  state: "open",
  entries: {},
};
export const ready: Thread = {
  id: "thread-1",
  title: "PR review",
  runtimeMode: "approval-required",
  interactionMode: "default",
  archivedAt: null,
  latestTurn: null,
  session: null,
};
function fixture(t: { after: (fn: () => void) => void }) {
  const home = mkdtempSync(join(tmpdir(), "t3poll-unit-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    rmSync(home, { recursive: true, force: true });
  });
  const now = { value: 1000 };
  const watch: Watch = {
    id: randomUUID(),
    key: "key",
    revision: 0,
    pr,
    threadId: ready.id,
    threadTitle: ready.title,
    origin: "http://localhost:1234",
    tokenFile: "/not-used",
    intervalSeconds: 60,
    status: "watching",
    createdAt: 0,
    expiresAt: 9999999,
    nextPoll: 0,
    lastPoll: null,
    snapshot: baseline,
    pending: [],
    command: null,
    nextDelivery: 0,
    pollFailures: 0,
    deliveryFailures: 0,
    lastError: null,
    deliveryError: null,
    lastDelivery: null,
  };
  store.add(watch);
  const sent: Command[] = [];
  const deps: Dependencies = {
    now: () => now.value,
    github: async () => baseline,
    thread: async () => ready,
    dispatch: async (_, c) => {
      sent.push(structuredClone(c));
      return 42;
    },
  };
  return { home, store, watch, now, deps, sent };
}
const changed = (n = 1): Snapshot => ({
  ...baseline,
  entries: {
    [`comment:${n}`]: {
      fingerprint: String(n),
      kind: "comment",
      label: `Comment ${n} added.`,
      url: `${pr}#comment-${n}`,
    },
  },
});

test("unchanged polls never dispatch; one changed snapshot dispatches once", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) {
    await tick(f.store, f.watch.id, f.deps);
    f.now.value += 60000;
  }
  assert.equal(f.sent.length, 0);
  f.deps.github = async () => changed();
  await tick(f.store, f.watch.id, f.deps);
  f.now.value += 60000;
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(
    f.sent[0]!.message.text,
    `[t3poll] New activity on ${pr}\nCheck the PR for updates and continue the task.`,
  );
  assert.equal(f.sent[0]!.runtimeMode, "approval-required");
  assert.equal(f.store.get(f.watch.id)!.lastDelivery!.sequence, 42);
});

test("busy thread coalesces feedback, then delivers when idle", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => changed();
  f.deps.thread = async () => ({ ...ready, hasPendingApprovals: true });
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 0);
  f.now.value += 60000;
  f.deps.github = async () => ({
    ...changed(),
    entries: { ...changed().entries, ...changed(2).entries },
  });
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.store.get(f.watch.id)!.pending.length, 2);
  f.deps.thread = async () => ready;
  f.now.value += 16000;
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.store.get(f.watch.id)!.pending.length, 0);
});

test("timeout retry survives reopen and uses identical IDs and payload even with new feedback", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => changed();
  let first: Command | undefined;
  f.deps.dispatch = async (_, c) => {
    first = structuredClone(c);
    throw new Error("Response lost after acceptance");
  };
  await tick(f.store, f.watch.id, f.deps);
  const reopened = new Store(f.home);
  try {
    assert.deepEqual(reopened.get(f.watch.id)!.command, first);
    f.now.value += 61000;
    f.deps.github = async () => ({
      ...changed(),
      entries: { ...changed().entries, ...changed(2).entries },
    });
    f.deps.dispatch = async (_, c) => {
      assert.deepEqual(c, first);
      return 42;
    };
    await tick(reopened, f.watch.id, f.deps);
    assert.equal(reopened.get(f.watch.id)!.command, null);
    assert.equal(reopened.get(f.watch.id)!.pending.length, 1);
  } finally {
    reopened.close();
  }
});

test("stop during an in-flight poll does not resurrect or deliver the watch", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => {
    f.store.stop(f.watch.id);
    return changed();
  };
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.store.get(f.watch.id)!.status, "stopped");
  assert.equal(f.sent.length, 0);
});

test("stop during destination read cancels the unsent message", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => changed();
  f.deps.thread = async () => {
    f.store.stop(f.watch.id);
    return ready;
  };
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 0);
});

test("GitHub failures preserve baseline and back off; closure sends final update", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => {
    throw new Error("offline");
  };
  await tick(f.store, f.watch.id, f.deps);
  assert.deepEqual(f.store.get(f.watch.id)!.snapshot, baseline);
  assert.equal(f.store.get(f.watch.id)!.nextPoll, 61000);
  f.now.value = 62000;
  f.deps.github = async () => ({ ...baseline, state: "merged" });
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.store.get(f.watch.id)!.status, "completed");
  assert.equal(f.store.get(f.watch.id)!.snapshot!.state, "merged");
});

test("expired watches stop without a model wakeup", async (t) => {
  const f = fixture(t);
  f.now.value = f.watch.expiresAt;
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.store.get(f.watch.id)!.status, "expired");
  assert.equal(f.sent.length, 0);
});

test("SQLite lease excludes another worker; idle retirement cannot strand a new watch", (t) => {
  const f = fixture(t);
  assert.equal(f.store.lease("one", 1, 100), true);
  assert.equal(f.store.lease("two", 2, 200), false);
  assert.equal(f.store.retire("one"), false);
  f.store.stop(f.watch.id);
  assert.equal(f.store.retire("one"), true);
  assert.equal(f.store.lease("two", 2, 300), true);
});

test("review edits, legacy statuses, and rerun attempts are recognized without heartbeat noise", async () => {
  let phase = 0;
  const read = () =>
    readGithub(pr, async (path) => {
      if (/pulls\/1$/.test(path))
        return { state: "open", merged: false, head: { sha: baseline.head } };
      if (path.includes("/reviews?"))
        return [
          [
            {
              id: 1,
              state: "APPROVED",
              body: phase ? "edited" : "",
              html_url: pr,
            },
          ],
          [{ id: 2, state: "PENDING", body: "draft", html_url: pr }],
        ];
      if (path.includes("/check-runs?"))
        return [
          {
            check_runs: [
              {
                id: phase ? 11 : 10,
                name: "test",
                status: "completed",
                conclusion: "success",
                html_url: pr,
                app: { id: 1 },
              },
            ],
          },
        ];
      if (path.includes("/statuses?"))
        return [
          [
            { id: 2, context: "build", state: "success", target_url: pr },
            { id: 1, context: "build", state: "failure", target_url: pr },
          ],
        ];
      return [[]];
    });
  const before = await read();
  assert.equal(Object.keys(before.entries).length, 3);
  assert.match(before.entries["status:build"]!.label, /success/);
  assert.equal(changesBetween(before, await read(), pr).length, 0);
  phase = 1;
  assert.equal(changesBetween(before, await read(), pr).length, 2);
});

test("config rejects unsafe origins and credential permissions", (t) => {
  const f = fixture(t);
  for (const url of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/?token=secret",
  ])
    assert.throws(() => validateOrigin(url));
  assert.equal(
    validateOrigin("http://127.0.0.1:3333"),
    "http://127.0.0.1:3333",
  );
  const token = join(f.home, "token");
  writeFileSync(token, "test-secret", { mode: 0o600 });
  assert.equal(readToken(token), "test-secret");
  makePublic(token);
  assert.throws(() => readToken(token));
  assert.throws(() => parsePr("https://evil.com/a/b/pull/1"));
  assert.throws(() => parsePr("file:///a/b/pull/1"));
});

test("unknown or approval-blocked destination states cannot be treated as idle", () => {
  assert.equal(
    availability({
      ...ready,
      session: { status: "new-state", activeTurnId: null },
    }),
    "blocked",
  );
  assert.equal(availability({ ...ready, hasPendingUserInput: true }), "busy");
});

test("a pending failed check is replaced by its recovery before a busy thread wakes", async (t) => {
  const f = fixture(t);
  let conclusion = "failure";
  f.deps.github = async () => ({
    ...baseline,
    entries: {
      "check:tests": {
        fingerprint: conclusion,
        kind: "check",
        label: `Tests: ${conclusion}`,
        url: pr,
      },
    },
  });
  f.deps.thread = async () => ({ ...ready, hasPendingUserInput: true });
  await tick(f.store, f.watch.id, f.deps);
  conclusion = "success";
  f.now.value += 60000;
  f.deps.thread = async () => ready;
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(
    f.store.get(f.watch.id)!.snapshot!.entries["check:tests"]!.fingerprint,
    "success",
  );
  assert.doesNotMatch(f.sent[0]!.message.text, /Tests: failure/);
});

test("an archived destination blocks retry without losing the original command", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => changed();
  f.deps.dispatch = async () => {
    throw new Error("Offline");
  };
  await tick(f.store, f.watch.id, f.deps);
  const original = f.store.get(f.watch.id)!.command;
  f.now.value += 61000;
  f.deps.thread = async () => {
    throw new Error("Destination thread is archived or deleted.");
  };
  f.deps.dispatch = async () => {
    assert.fail("Must not dispatch to archived thread");
  };
  await tick(f.store, f.watch.id, f.deps);
  assert.deepEqual(f.store.get(f.watch.id)!.command, original);
  assert.match(f.store.get(f.watch.id)!.deliveryError!, /archived/);
});

test("an accepted delivery is not repeated when the provider later fails", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => changed();
  await tick(f.store, f.watch.id, f.deps);
  f.now.value += 61000;
  f.deps.thread = async () => ({
    ...ready,
    session: { status: "error", activeTurnId: null },
  });
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.store.get(f.watch.id)!.command, null);
});

test("running threads receive updates immediately, but approval and input prompts hold delivery", async (t) => {
  const f = fixture(t);
  f.deps.github = async () => changed();
  const running: Thread = {
    ...ready,
    session: { status: "running", activeTurnId: "active-turn" },
    latestTurn: { state: "running", completedAt: null },
  };
  for (const flag of ["hasPendingApprovals", "hasPendingUserInput"] as const) {
    f.deps.thread = async () => ({ ...running, [flag]: true });
    await tick(f.store, f.watch.id, f.deps);
    assert.equal(f.sent.length, 0);
    f.now.value += 16000;
  }
  f.deps.thread = async () => running;
  await tick(f.store, f.watch.id, f.deps);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0]!.type, "thread.turn.start");
  assert.equal(
    f.sent[0]!.message.text,
    `[t3poll] New activity on ${pr}\nCheck the PR for updates and continue the task.`,
  );
});
