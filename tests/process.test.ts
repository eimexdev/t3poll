import { executable } from "./fixtures/executable.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Store } from "../src/store.js";
import type { Command } from "../src/model.js";

const exec = promisify(execFile);
const cli = resolve("dist/cli.js");
async function until(check: () => boolean, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end)
      throw new Error("Timed out waiting for observable process state");
    await delay(25);
  }
}

test(
  "MCP watch starts one independent worker; delivery survives MCP exit; CLI stops it",
  { timeout: 30000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), "t3poll-process-"));
    const bin = join(home, "bin");
    mkdirSync(bin);
    const phaseFile = join(home, "phase");
    writeFileSync(phaseFile, "0");
    executable(
      bin,
      "gh",
      `#!${process.execPath}
const fs=require('node:fs');
const phase=Number(fs.readFileSync(${JSON.stringify(phaseFile)},'utf8'));
const path=process.argv.at(-1);
let result=[[]];
if (/pulls\\/1$/.test(path)) result={state:'open',merged:false,head:{sha:'a'.repeat(40)}};
else if(path.includes('/check-runs?')) result=[{check_runs:[]}];
else if(path.includes('/issues/') && phase) result=[[{id:phase,body:'Do not copy this untrusted text into the wakeup',html_url:'https://github.com/owner/repo/pull/1#issuecomment-'+phase}]];
process.stdout.write(JSON.stringify(result));
`,
    );
    const tokenFile = join(home, "token");
    writeFileSync(tokenFile, "fixture-token", { mode: 0o600 });
    const commands: Command[] = [];
    let busy = false;
    const server = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, "Bearer fixture-token");
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/orchestration/shell") {
        response.end(
          JSON.stringify({
            threads: [
              {
                id: "thread-1",
                title: "Review this PR",
                runtimeMode: "approval-required",
                interactionMode: "default",
                archivedAt: null,
                latestTurn: null,
                session: null,
                hasPendingApprovals: busy,
                hasPendingUserInput: false,
              },
            ],
          }),
        );
      } else if (request.url === "/api/orchestration/dispatch") {
        let body = "";
        for await (const chunk of request) body += chunk;
        commands.push(JSON.parse(body));
        response.end(JSON.stringify({ sequence: commands.length }));
      } else {
        response.statusCode = 404;
        response.end("{}");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const env = {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      T3POLL_HOME: home,
      T3POLL_URL: `http://127.0.0.1:${address.port}`,
      T3POLL_TOKEN_FILE: tokenFile,
    } as Record<string, string>;
    const store = new Store(home);
    let pid: number | undefined;
    let client: Client | undefined;
    try {
      client = new Client({ name: "t3poll-test", version: "1" });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [cli, "mcp"],
          env,
          stderr: "pipe",
        }),
      );
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
        "list",
        "stop",
        "watch",
      ]);
      const destinations = await client.callTool({
        name: "list",
        arguments: { threads: true },
      });
      assert.equal(
        (destinations.structuredContent as any).threads[0].id,
        "thread-1",
      );
      const result = await client.callTool({
        name: "watch",
        arguments: {
          pr: "https://github.com/owner/repo/pull/1",
          threadId: "thread-1",
        },
      });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const watch = result.structuredContent as any;
      pid = watch.worker.pid;
      assert.ok(pid);
      assert.equal(watch.intervalSeconds, 60);
      const duplicate = await client.callTool({
        name: "watch",
        arguments: {
          pr: "https://github.com/owner/repo/pull/1",
          threadId: "thread-1",
        },
      });
      assert.equal((duplicate.structuredContent as any).worker.pid, pid);
      assert.equal(store.all().length, 1);
      await client.close();
      client = undefined;
      assert.equal(commands.length, 0);
      writeFileSync(phaseFile, "1");
      const due = store.get(watch.id)!;
      due.nextPoll = 0;
      store.save(due);
      await until(() => commands.length === 1);
      assert.equal(commands[0]!.threadId, "thread-1");
      assert.match(commands[0]!.message.text, /Check the PR for updates/);
      assert.doesNotMatch(commands[0]!.message.text, /Do not copy this/);
      await until(() => store.get(watch.id)!.lastDelivery !== null);
      busy = true;
      writeFileSync(phaseFile, "2");
      const next = store.get(watch.id)!;
      next.nextPoll = 0;
      next.nextDelivery = 0;
      store.save(next);
      await until(() => store.get(watch.id)!.pending.length > 0);
      assert.equal(commands.length, 1);
      const stopped = await exec(process.execPath, [cli, "stop", watch.id], {
        env,
      });
      assert.equal(JSON.parse(stopped.stdout).status, "stopped");
      await until(() => !store.worker());
      assert.equal(commands.length, 1);
    } finally {
      await client?.close();
      for (const w of store.work()) store.stop(w.id);
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
      await until(() => !store.worker()).catch(() => {});
      store.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
    }
  },
);
