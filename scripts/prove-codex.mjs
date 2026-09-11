// Verify real Codex MCP scoping without model calls or changes to user configuration.
// T3POLL_TEST_CODEX_BIN=/absolute/path/to/codex[.exe] node scripts/prove-codex.mjs
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

const binary = process.env.T3POLL_TEST_CODEX_BIN;
if (!binary)
  throw new Error(
    "Set T3POLL_TEST_CODEX_BIN to an installed Codex executable.",
  );
const root = mkdtempSync(join(tmpdir(), "t3poll-codex-space-"));
const base = join(root, "t3");
const pkg = join(root, "package");
const home = join(root, "codex");
for (const directory of [base, home, join(pkg, "dist")])
  mkdirSync(directory, { recursive: true });
writeFileSync(
  join(pkg, "package.json"),
  JSON.stringify({ name: "t3", type: "module" }),
);
copyFileSync(resolve("tests/fixtures/local-t3.mjs"), join(pkg, "dist/bin.mjs"));
const server = spawn(process.execPath, [join(pkg, "dist/bin.mjs"), "serve"], {
  env: { ...process.env, T3CODE_HOME: base },
  stdio: ["ignore", "pipe", "pipe"],
});
writeFileSync(
  join(home, "config.toml"),
  `
[mcp_servers.t3poll]
enabled = false
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(resolve(process.env.T3POLL_TEST_CLI ?? "dist/cli.js"))}, "mcp"]
[mcp_servers.t3poll.env]
T3POLL_HOME = ${JSON.stringify(join(root, "poll"))}
T3POLL_BASE_DIR = ${JSON.stringify(base)}
`,
);
async function check(enabled) {
  const child = spawn(
    binary,
    [
      "app-server",
      ...(enabled ? ["-c", "mcp_servers.t3poll.enabled=true"] : []),
    ],
    {
      env: { ...process.env, CODEX_HOME: home },
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors = (errors + chunk).slice(-3000);
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined) pending.get(message.id)?.(message);
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      const timeout = setTimeout(() => {
        pending.delete(request);
        reject(new Error(`Codex timed out: ${method}; ${errors}`));
      }, 20000);
      pending.set(request, (message) => {
        clearTimeout(timeout);
        pending.delete(request);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: request, method, params }) + "\n",
      );
    });
  try {
    await rpc("initialize", {
      clientInfo: { name: "t3poll-proof", version: "1" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n",
    );
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = await rpc("mcpServerStatus/list", {});
      const status = result.data.find((item) => item.name === "t3poll");
      if (!enabled) {
        assert.deepEqual(Object.keys(status?.tools ?? {}), []);
        return;
      }
      if (status && Object.keys(status.tools).length) {
        assert.deepEqual(
          Object.values(status.tools)
            .map((tool) => tool.name)
            .sort(),
          ["list", "stop", "watch"],
        );
        return;
      }
      await delay(250);
    }
    throw new Error(`Codex did not expose t3poll tools; ${errors}`);
  } finally {
    lines.close();
    if (child.exitCode === null) {
      const exit = once(child, "exit");
      if (process.platform === "win32") {
        // Stop only this proof's Codex tree, including its MCP children.
        await promisify(execFile)(
          join(process.env.SystemRoot, "System32", "taskkill.exe"),
          ["/pid", String(child.pid), "/t", "/f"],
        );
      } else child.kill();
      await exit;
    }
  }
}
try {
  await once(server.stdout, "data");
  await check(false);
  await check(true);
  console.log(
    "PASS: real Codex hides t3poll by default and exposes list/stop/watch with the T3 launch override. No model calls or user configuration changes.",
  );
} finally {
  const exit = once(server, "exit");
  server.kill();
  await exit;
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
