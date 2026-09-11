// Exercise setup against a disposable stock T3 instance. No threads/model calls.
// T3POLL_TEST_T3_BIN and T3POLL_TEST_CODEX_BIN select installed executables.
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { executable } from "../tests/fixtures/executable.mjs";
const exec = promisify(execFile);
const binary = process.env.T3POLL_TEST_T3_BIN,
  codex = process.env.T3POLL_TEST_CODEX_BIN;
if (!binary || !codex)
  throw new Error("Set T3POLL_TEST_T3_BIN and T3POLL_TEST_CODEX_BIN.");
const runtime = process.env.T3POLL_TEST_T3_RUNTIME || process.execPath;
const root = mkdtempSync(join(tmpdir(), "t3poll installer café space-"));
const base = join(root, "t3"),
  home = join(root, "codex"),
  state = join(root, "state"),
  bin = join(root, "bin");
mkdirSync(join(base, "userdata"), { recursive: true });
mkdirSync(bin);
executable(bin, "gh", "process.exit(0)");
writeFileSync(
  join(base, "userdata/settings.json"),
  JSON.stringify({
    providers: { codex: { binaryPath: codex, homePath: home } },
  }),
);
const portServer = createServer();
await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
const env = {
  PATH: `${bin}${delimiter}${process.env.PATH}`,
  HOME: root,
  USERPROFILE: root,
  CODEX_HOME: home,
  T3CODE_HOME: base,
  ...(process.platform === "win32"
    ? {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec,
        TEMP: root,
        TMP: root,
        APPDATA: join(root, "AppData/Roaming"),
        LOCALAPPDATA: join(root, "AppData/Local"),
      }
    : {}),
};
await exec(
  runtime,
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
  {
    cwd: root,
    env: {
      ...env,
      ...(runtime !== process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    timeout: 30000,
  },
);
const server = spawn(
  runtime,
  [
    binary,
    "--base-dir",
    base,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--no-browser",
  ],
  {
    cwd: root,
    env: {
      ...env,
      ...(runtime !== process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let errors = "";
server.stdout.on("data", (chunk) => {
  errors = (errors + chunk).slice(-4000);
});
server.stderr.on("data", (chunk) => {
  errors = (errors + chunk).slice(-2000);
});
try {
  for (
    let i = 0;
    !existsSync(join(base, "userdata/server-runtime.json"));
    i++
  ) {
    if (i > 300 || server.exitCode !== null)
      throw new Error(`T3 did not start: ${errors}`);
    await delay(100);
  }
  const cli = resolve(process.env.T3POLL_TEST_CLI || "dist/cli.js");
  const args = [
    cli,
    "setup",
    "--base-dir",
    base,
    "--state-home",
    state,
    "--runtime-path",
    cli,
  ];
  const before = readFileSync(join(base, "userdata/settings.json"), "utf8");
  const preview = await exec(process.execPath, [...args, "--dry-run"], {
    env,
    timeout: 60000,
  });
  assert.match(preview.stdout, /Dry run complete/);
  assert.equal(existsSync(state), false);
  assert.equal(
    readFileSync(join(base, "userdata/settings.json"), "utf8"),
    before,
  );
  const result = await exec(process.execPath, [...args, "--yes"], {
    env,
    timeout: 60000,
  });
  assert.match(result.stdout, /Setup complete/);
  const config = readFileSync(join(home, "config.toml"), "utf8");
  assert.match(config, /enabled = false/);
  const again = await exec(process.execPath, [...args, "--yes"], {
    env,
    timeout: 60000,
  });
  assert.match(again.stdout, /Setup complete/);
  assert.equal(readFileSync(join(home, "config.toml"), "utf8"), config);
  console.log(
    "PASS: stock T3 installer dry run, config writes, real Codex prerequisite, managed credentials, MCP verification, and idempotent rerun. No threads or messages created.",
  );
} finally {
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
