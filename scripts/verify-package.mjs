// Exercise an installed tarball without global installs or user configuration.
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const tarball = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "t3poll packed café "));
const npm = [
  process.env.npm_execpath,
  join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
  join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  "/usr/share/nodejs/npm/bin/npm-cli.js",
].find((p) => p?.endsWith("npm-cli.js") && existsSync(p));
if (!npm)
  throw new Error(
    "Run via npm run verify:package so npm_execpath is available",
  );
const expected = JSON.parse(readFileSync("package.json", "utf8"));
const client = new Client({ name: "package-proof", version: "1" });
try {
  execFileSync(
    process.execPath,
    [
      realpathSync(npm),
      "install",
      "--prefix",
      root,
      "--omit=dev",
      "--ignore-scripts",
      tarball,
    ],
    { stdio: "pipe", timeout: 120000 },
  );
  const pkg = join(root, "node_modules/t3poll");
  const actual = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
  assert.equal(actual.version, expected.version);
  assert.deepEqual(actual.t3pollRelease, expected.t3pollRelease);
  const cli = join(pkg, "dist/cli.js");
  const help = execFileSync(process.execPath, [cli, "setup", "--help"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.match(help, /t3poll setup/);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  );
  env.T3POLL_HOME = join(root, "state");
  env.T3POLL_URL = "";
  env.T3POLL_TOKEN_FILE = "";
  env.T3POLL_BASE_DIR = join(root, "no-t3");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    env,
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});
  await client.connect(transport);
  assert.equal(client.getServerVersion().version, expected.version);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
    "list",
    "stop",
    "watch",
  ]);
  console.log(
    `PASS packed ${actual.name}@${actual.version}: setup CLI, runtime version, MCP tools`,
  );
} finally {
  await client.close();
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
