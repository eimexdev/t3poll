import { rm } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { protectFile } from "../src/private-files.js";
import { Store } from "../src/store.js";
import { newer } from "../src/runtime.js";
import type { Watch, Command } from "../src/model.js";
const exec = promisify(execFile);
async function until(check: () => boolean) {
  const end = Date.now() + 12000;
  while (!check()) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for worker handoff");
    await delay(25);
  }
}

test("release ordering prevents old sessions from downgrading workers", () => {
  assert.equal(newer("0.1.1-nightly.20260912000000", "0.1.0"), true);
  assert.equal(newer("0.1.1", "0.1.1-nightly.20260912000000"), true);
  assert.equal(newer("0.1.1-nightly.20260912000000", "0.1.1"), false);
  assert.equal(
    newer("0.1.1-nightly.20260912000001", "0.1.1-nightly.20260912000000"),
    true,
  );
  assert.equal(newer("dev", "0.1.1"), false);
});

for (const ambiguous of [false, true])
  test(
    `worker upgrade preserves ${ambiguous ? "ambiguous" : "accepted"} in-flight delivery and rejects downgrades and broken candidates`,
    { timeout: 60000 },
    async () => {
      const home = mkdtempSync(join(tmpdir(), "t3poll upgrade café "));
      function build(name: string, version: string) {
        const dir = join(home, name);
        mkdirSync(dir);
        cpSync(resolve("dist"), join(dir, "dist"), { recursive: true });
        symlinkSync(
          resolve("node_modules"),
          join(dir, "node_modules"),
          "junction",
        );
        writeFileSync(
          join(dir, "package.json"),
          JSON.stringify({ type: "module", version }),
        );
        return join(dir, "dist", "cli.js");
      }
      const old = build("old", "0.1.1-nightly.20260912000000");
      const next = build("next", "0.1.1-nightly.20260912000001");
      const broken = build("broken", "0.1.2");
      writeFileSync(
        broken,
        readFileSync(broken, "utf8").replace(
          "await runWorker(config.home);",
          "throw new Error('broken candidate');",
        ),
      );
      const env = { ...process.env, T3POLL_HOME: join(home, "state") };
      const list = async (cli: string) =>
        JSON.parse(
          (await exec(process.execPath, [cli, "list"], { env })).stdout,
        );
      const commands: Command[] = [];
      let finish: (() => void) | undefined;
      const server = createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/orchestration/shell") {
          res.end(
            JSON.stringify({
              threads: [
                {
                  id: "thread",
                  title: "Review",
                  runtimeMode: "approval-required",
                  interactionMode: "default",
                  archivedAt: null,
                  latestTurn: null,
                  session: null,
                },
              ],
            }),
          );
        } else {
          let body = "";
          for await (const chunk of req) body += chunk;
          commands.push(JSON.parse(body));
          if (commands.length === 1)
            finish = () => {
              res.statusCode = ambiguous ? 503 : 200;
              res.end(JSON.stringify({ sequence: 1 }));
            };
          else res.end(JSON.stringify({ sequence: commands.length }));
        }
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const tokenFile = join(home, "token");
      writeFileSync(tokenFile, "test-token", { mode: 0o600 });
      protectFile(tokenFile);
      const store = new Store(env.T3POLL_HOME);
      const now = Date.now();
      const watch: Watch = {
        id: "watch",
        key: "key",
        revision: 0,
        pr: "https://github.com/owner/repo/pull/1",
        threadId: "thread",
        threadTitle: "Review",
        origin: `http://127.0.0.1:${address.port}`,
        tokenFile,
        intervalSeconds: 60,
        status: "watching",
        createdAt: now,
        expiresAt: now + 3600000,
        nextPoll: now + 3600000,
        lastPoll: now,
        snapshot: { head: "a".repeat(40), state: "open", entries: {} },
        pending: [
          {
            key: "comment:1",
            text: "New comment",
            url: "https://github.com/owner/repo/pull/1",
          },
        ],
        command: null,
        nextDelivery: 0,
        pollFailures: 0,
        deliveryFailures: 0,
        lastError: null,
        deliveryError: null,
        lastDelivery: null,
      };
      store.add(watch);
      try {
        const initial = await list(old);
        await until(() => commands.length === 1);
        const frozen = store.get(watch.id)!.command;
        assert.ok(frozen);
        const upgrading = Promise.all([list(next), list(next)]);
        await until(
          () => store.target()?.version === "0.1.1-nightly.20260912000001",
        );
        assert.equal(store.worker()!.pid, initial.worker.pid);
        assert.deepEqual(store.get(watch.id)!.command, frozen);
        assert.equal(commands.length, 1);
        finish!();
        const [upgraded, concurrent] = await upgrading;
        assert.equal(upgraded.worker.pid, concurrent.worker.pid);
        assert.notEqual(upgraded.worker.pid, initial.worker.pid);
        assert.equal(upgraded.worker.version, "0.1.1-nightly.20260912000001");
        if (ambiguous) {
          const retry = store.get(watch.id)!;
          assert.deepEqual(retry.command, frozen);
          retry.nextDelivery = 0;
          store.save(retry);
          await until(() => store.get(watch.id)!.lastDelivery !== null);
          assert.deepEqual(commands[1], commands[0]);
        }
        const saved = store.get(watch.id)!;
        assert.equal(saved.id, watch.id);
        assert.equal(saved.expiresAt, watch.expiresAt);
        assert.deepEqual(saved.snapshot, watch.snapshot);
        assert.equal(saved.command, null);
        assert.equal(saved.lastDelivery!.messageId, frozen.message.messageId);
        assert.equal(commands.length, ambiguous ? 2 : 1);
        assert.equal((await list(old)).worker.pid, upgraded.worker.pid);
        const failedUpdate = await list(broken);
        assert.match(failedUpdate.worker.error, /Worker update failed/);
        assert.equal(failedUpdate.worker.pid, upgraded.worker.pid);
        assert.equal(store.worker()!.pid, upgraded.worker.pid);
        assert.equal(store.target()!.version, upgraded.worker.version);
        // Retained runtime also wins when an old session starts a worker after idle.
        store.stop(watch.id);
        await until(() => !store.worker());
        const resumed = store.get(watch.id)!;
        resumed.status = "watching";
        resumed.pending = [{ key: "comment:2", text: "Queued", url: watch.pr }];
        resumed.nextDelivery = Date.now() + 60000;
        store.save(resumed);
        const restarted = await list(old);
        assert.equal(restarted.worker.version, upgraded.worker.version);
        assert.deepEqual(store.get(watch.id)!.pending, resumed.pending);
        store.stop(watch.id);
        await until(() => !store.worker());
        const persisted = store.get(watch.id)!;
        persisted.status = "watching";
        store.save(persisted);
        const client = new Client({ name: "startup-test", version: "1" });
        try {
          await client.connect(
            new StdioClientTransport({
              command: process.execPath,
              args: [old, "mcp"],
              env: env as Record<string, string>,
              stderr: "pipe",
            }),
          );
          await until(() => !!store.worker());
          assert.equal(store.worker()!.version, upgraded.worker.version);
        } finally {
          await client.close();
        }
      } finally {
        finish?.();
        for (const w of store.work()) store.stop(w.id);
        await until(() => !store.worker()).catch(() => {});
        store.close();
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
        await rm(home, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      }
    },
  );
