import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { windows } from "../src/windows.js";
import { readLocalProcess, hasOpenFile } from "../src/local-process.js";
import { privateDirectory, assertPrivateFile } from "../src/private-files.js";
import { makePublic } from "./fixtures/permissions.js";

test(
  "Windows inspects Unicode paths, quoting, large environments, and exact open files",
  { skip: process.platform !== "win32" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "t3poll Windows café-"));
    const file = join(root, "open database.sqlite");
    const unrelated = join(root, "unrelated.sqlite");
    writeFileSync(unrelated, "unused");
    const args = [
      "-e",
      "const fs=require('node:fs'); fs.openSync(process.argv[1],'w'); console.log('ready'); setInterval(()=>{},1000)",
      file,
      'quote"inside',
      "trailing\\",
      "",
    ];
    const large = "value=with spaces ".repeat(1024);
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, T3POLL_LARGE_ENV: large },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await once(child.stdout!, "data");
      const details = readLocalProcess(child.pid!);
      assert.deepEqual(details.args.slice(1), args);
      assert.equal(details.cwd.replace(/[\\/]$/, ""), root);
      assert.equal(details.env.T3POLL_LARGE_ENV, large);
      assert.equal(hasOpenFile(child.pid!, file), true);
      assert.equal(hasOpenFile(child.pid!, unrelated), false);
      assert.throws(() => windows().inspect(0));
    } finally {
      const exit = once(child, "exit");
      child.kill();
      await exit;
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
  },
);

test(
  "Windows private directories protect new files and reject a Users grant",
  { skip: process.platform !== "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "t3poll ACL café-"));
    try {
      privateDirectory(root);
      const file = join(root, "token");
      writeFileSync(file, "fixture-token");
      assert.doesNotThrow(() => assertPrivateFile(file));
      makePublic(file);
      assert.throws(() => assertPrivateFile(file), /another user/);
      windows().protect(file);
      assert.doesNotThrow(() => assertPrivateFile(file));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
