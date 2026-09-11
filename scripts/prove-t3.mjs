// Run against an installed, unmodified T3 release. Never connects to an existing server.
// T3POLL_TEST_T3_BIN=/absolute/path/to/t3/dist/bin.mjs node scripts/prove-t3.mjs
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  chmodSync,
  openSync,
  closeSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Store } from "../dist/store.js";

const exec = promisify(execFile);
const binary = process.env.T3POLL_TEST_T3_BIN;
if (!binary)
  throw new Error(
    "Set T3POLL_TEST_T3_BIN to a separately installed stock T3 dist/bin.mjs.",
  );
const root = mkdtempSync(join(tmpdir(), "t3poll-stock-"));
const base = join(root, "t3");
const home = join(root, "home");
const work = join(root, "repo");
const bin = join(root, "bin");
for (const dir of [base, home, work, bin]) mkdirSync(dir, { mode: 0o700 });
const node = process.execPath;
const providerLog = join(root, "provider.jsonl");
copyFileSync(resolve("tests/fixtures/codex.mjs"), join(bin, "codex"));
chmodSync(join(bin, "codex"), 0o700);
const phase = join(root, "phase");
writeFileSync(phase, "0");
writeFileSync(
  join(bin, "gh"),
  `#!${node}
const fs=require('node:fs');const path=process.argv.at(-1);let result=[[]];
if (/pulls\\/1$/.test(path)) result={state:'open',merged:false,head:{sha:'a'.repeat(40)}};
else if(path.includes('/check-runs?')) result=[{check_runs:[]}];
else if(path.includes('/issues/') && fs.readFileSync(${JSON.stringify(phase)},'utf8')>='1') result=[[{id:42,body:'New feedback '+fs.readFileSync(${JSON.stringify(phase)},'utf8'),html_url:'https://github.com/owner/repo/pull/1#issuecomment-42'}]];
process.stdout.write(JSON.stringify(result));
`,
  { mode: 0o700 },
);
const env = {
  PATH: `${bin}:${dirname(node)}:/usr/bin:/bin`,
  HOME: home,
  CODEX_HOME: join(home, ".codex"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  T3CODE_HOME: base,
  T3POLL_TEST_PROVIDER_LOG: providerLog,
  T3POLL_TEST_TURN_DELAY_MS: "5000",
  LANG: "C.UTF-8",
};
await exec("git", ["init", work], { env });
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
const logs = join(root, "server.log");
const log = openSync(logs, "a", 0o600);
let server;
let client;
let store;
let workerPid;
let token = "";
let inspectThread;
async function until(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Isolated proof timed out");
    await delay(100);
  }
}
try {
  const issued = await exec(
    node,
    [
      binary,
      "auth",
      "session",
      "issue",
      "--base-dir",
      base,
      "--ttl",
      "1h",
      "--token-only",
    ],
    { env, cwd: work, timeout: 30000 },
  );
  token = issued.stdout.trim();
  const tokenFile = join(root, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  server = spawn(
    node,
    [
      binary,
      "--base-dir",
      base,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-browser",
      "--auto-bootstrap-project-from-cwd",
      work,
    ],
    { env, cwd: work, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  const request = async (path, body) => {
    const res = await fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok)
      throw new Error(
        `T3 HTTP ${res.status}: ${(await res.text()).slice(0, 600)}`,
      );
    return res.json();
  };
  await until(async () => {
    if (server.exitCode !== null) throw new Error("Isolated T3 exited");
    try {
      await request("/api/orchestration/shell");
      return true;
    } catch {
      return false;
    }
  });
  const shell = await request("/api/orchestration/shell");
  const projectId = shell.projects[0]?.id ?? randomUUID();
  if (!shell.projects.length)
    await request("/api/orchestration/dispatch", {
      type: "project.create",
      commandId: randomUUID(),
      projectId,
      title: "Proof",
      workspaceRoot: work,
      createdAt: new Date().toISOString(),
    });
  const threadId = randomUUID();
  inspectThread = async () => {
    const { thread } = await request(`/api/orchestration/threads/${threadId}`);
    return {
      session: thread.session,
      latestTurn: thread.latestTurn,
      activities: thread.activities,
    };
  };
  await request("/api/orchestration/dispatch", {
    type: "thread.create",
    commandId: randomUUID(),
    threadId,
    projectId,
    title: "t3poll isolated proof",
    modelSelection: { instanceId: "codex", model: "gpt-5.3-codex" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: new Date().toISOString(),
  });
  client = new Client({ name: "t3poll-proof", version: "1" });
  const pollHome = join(root, "poll");
  await client.connect(
    new StdioClientTransport({
      command: node,
      args: [resolve("dist/cli.js"), "mcp"],
      env: {
        ...env,
        T3POLL_HOME: pollHome,
      },
      stderr: "pipe",
    }),
  );
  const connected = await client.callTool({
    name: "list",
    arguments: { threads: true },
  });
  assert.ok(!connected.isError, JSON.stringify(connected));
  assert.ok(connected.structuredContent.threads.some((t) => t.id === threadId));
  const registered = await client.callTool({
    name: "watch",
    arguments: { pr: "https://github.com/owner/repo/pull/1", threadId },
  });
  assert.ok(!registered.isError, JSON.stringify(registered));
  workerPid = registered.structuredContent.worker.pid;
  const id = registered.structuredContent.id;
  await client.close();
  client = undefined;
  store = new Store(pollHome);
  writeFileSync(phase, "1");
  const watch = store.get(id);
  watch.nextPoll = 0;
  assert.ok(store.save(watch));
  await until(() => store.get(id)?.lastDelivery !== null);
  const detail = await request(`/api/orchestration/threads/${threadId}`);
  assert.equal(
    detail.thread.messages.filter((m) => m.text.includes("[t3poll]")).length,
    1,
  );
  await until(async () => {
    const detail = await inspectThread();
    if (detail.session?.status === "error")
      throw new Error(detail.session.lastError);
    return (
      existsSync(providerLog) &&
      readFileSync(providerLog, "utf8").includes("[t3poll]")
    );
  });
  // Deliver a second update while the scripted provider's first turn remains active.
  await until(
    async () => (await inspectThread()).session?.status === "running",
  );
  writeFileSync(phase, "2");
  const activeWatch = store.get(id);
  // Force renewal inside the detached worker without a setup tool or manual token.
  const managedPath = `${activeWatch.tokenFile}.managed.json`;
  const oldToken = readFileSync(activeWatch.tokenFile, "utf8");
  const metadata = JSON.parse(readFileSync(managedPath, "utf8"));
  metadata.expiresAt = new Date(0).toISOString();
  writeFileSync(managedPath, JSON.stringify(metadata));
  activeWatch.nextPoll = 0;
  activeWatch.nextDelivery = 0;
  assert.ok(store.save(activeWatch));
  await until(
    () =>
      existsSync(providerLog) &&
      readFileSync(providerLog, "utf8").trim().split("\n").length >= 2,
  );
  await until(
    async () => (await inspectThread()).session?.status === "running",
  );
  await until(
    async () =>
      (await request(`/api/orchestration/threads/${threadId}`)).thread
        .latestTurn?.state === "completed",
  );
  assert.equal(
    JSON.parse(readFileSync(providerLog, "utf8").trim().split("\n")[1])
      .testWasRunning,
    true,
  );
  assert.notEqual(readFileSync(activeWatch.tokenFile, "utf8"), oldToken);
  // A fresh CLI process uses the saved automatic connection and credential.
  const checked = await exec(
    node,
    [resolve("dist/cli.js"), "list", "--threads"],
    { env: { ...env, T3POLL_HOME: pollHome }, timeout: 30000 },
  );
  assert.ok(JSON.parse(checked.stdout).threads.some((t) => t.id === threadId));
  // Exact same dispatch must not append another message or invoke another provider turn.
  const body = {
    type: "thread.turn.start",
    commandId: randomUUID(),
    threadId,
    message: {
      messageId: randomUUID(),
      role: "user",
      text: "[t3poll] Receipt retry proof",
      attachments: [],
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt: new Date().toISOString(),
  };
  const first = await request("/api/orchestration/dispatch", body);
  const second = await request("/api/orchestration/dispatch", body);
  assert.equal(first.sequence, second.sequence);
  const retryDetail = await request(`/api/orchestration/threads/${threadId}`);
  assert.equal(
    retryDetail.thread.messages.filter((m) => m.id === body.message.messageId)
      .length,
    1,
  );
  store.stop(id);
  await until(() => !store.worker());
  console.log(
    "PASS: automatic discovery, initial credential creation, worker renewal, and CLI reuse succeeded; stock T3 accepted MCP-started background delivery after MCP disconnect, delivered another update during a running scripted Codex turn, completed the turn, and deduplicated an identical command.",
  );
} catch (error) {
  console.error(String(error).replaceAll(token || "\0", "[redacted]"));
  if (inspectThread)
    console.error(
      JSON.stringify(await inspectThread().catch(() => ({}))).slice(-9000),
    );
  if (existsSync(logs))
    console.error(
      readFileSync(logs, "utf8")
        .slice(-7000)
        .replaceAll(token || "\0", "[redacted]")
        .replace(/token=[^\s]+/g, "token=[redacted]"),
    );
  process.exitCode = 1;
} finally {
  await client?.close();
  if (store) {
    for (const w of store.work()) store.stop(w.id);
  }
  if (workerPid) {
    try {
      process.kill(workerPid, "SIGTERM");
    } catch {}
  }
  if (store) {
    await until(() => !store.worker(), 10000).catch(() => {});
    store.close();
  }
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    const kill = setTimeout(() => server.kill("SIGKILL"), 10000);
    await exited;
    clearTimeout(kill);
  }
  rmSync(root, { recursive: true, force: true });
}
