import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { parseProcArgs, readLocalProcess } from "../src/local-process.js";

test("macOS argument decoding preserves spaces, empty arguments, and environment equals signs", () => {
  const argc = Buffer.alloc(4);
  argc.writeInt32LE(4);
  const decoded = parseProcArgs(
    Buffer.concat([
      argc,
      Buffer.from(
        "/Application With Spaces/runtime\0\0\0node\0/path with spaces/bin.mjs\0\0--base-dir=/home with spaces\0T3CODE_HOME=/home with spaces\0VALUE=a=b\0\0",
      ),
    ]),
  );
  assert.deepEqual(decoded.args, [
    "node",
    "/path with spaces/bin.mjs",
    "",
    "--base-dir=/home with spaces",
  ]);
  assert.deepEqual(decoded.env, {
    T3CODE_HOME: "/home with spaces",
    VALUE: "a=b",
  });
  assert.throws(() => parseProcArgs(Buffer.from([1, 0, 0, 0, 65])));
});

test("live process inspection preserves argument boundaries and selected environment values", async () => {
  const args = [
    "-e",
    "console.log('ready'); setInterval(() => {}, 1000)",
    "space in argument",
    "",
    "a=b",
  ];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, T3POLL_PROCESS_TEST: "value with spaces=too" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await once(child.stdout!, "data");
    const inspected = readLocalProcess(child.pid!);
    assert.deepEqual(inspected.args.slice(1, args.length + 1), args);
    assert.equal(inspected.env.T3POLL_PROCESS_TEST, "value with spaces=too");
    assert.equal(realpathSync(inspected.cwd), realpathSync(process.cwd()));
    assert.equal(
      realpathSync(inspected.executable),
      realpathSync(process.execPath),
    );
  } finally {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }
});
