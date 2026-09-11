import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import {
  connection,
  discover,
  inspectLocal,
  renewManaged,
} from "../src/setup.js";
import { T3 } from "../src/t3.js";
import { Service } from "../src/service.js";
const exec = promisify(execFile);
async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  launch: "direct" | "absolute-link" | "relative-link" = "direct",
) {
  const root = mkdtempSync(join(tmpdir(), "t3poll setup space-"));
  const base = join(root, "t3");
  const home = join(root, "poll");
  const pkg = join(root, "package");
  mkdirSync(base);
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "t3", type: "module" }),
  );
  const cli = join(pkg, "dist/bin.mjs");
  copyFileSync(resolve("tests/fixtures/local-t3.mjs"), cli);
  const link = join(root, "t3-bin");
  symlinkSync(cli, link);
  const command =
    launch === "direct" ? cli : launch === "absolute-link" ? link : "./t3-bin";
  const child = spawn(process.execPath, [command, "serve"], {
    cwd: root,
    env: { ...process.env, T3CODE_HOME: base },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const [output] = await once(child.stdout!, "data");
  const origin = output.toString().trim();
  const config = { home, baseDir: base };
  const issued = () =>
    existsSync(join(base, "issued"))
      ? readFileSync(join(base, "issued"), "utf8").trim().split("\n").length
      : 0;
  return { root, base, home, origin, config, issued };
}

test("first use discovers local T3, creates a private verified credential, and reuses it", async (t) => {
  const f = await fixture(t);
  assert.equal(discover(f.config).origin, f.origin);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => connection(f.config)),
  );
  assert.equal(f.issued(), 1);
  assert.ok(results.every((r) => r.tokenFile === results[0]!.tokenFile));
  assert.equal(statSync(results[0]!.tokenFile).mode & 0o777, 0o600);
  assert.deepEqual(await new T3(f.origin, results[0]!.tokenFile).threads(), []);
  const service = new Service(f.config);
  try {
    assert.deepEqual((await service.list(true)).threads, []);
  } finally {
    service.close();
  }
  assert.equal(f.issued(), 1);
});

test("separate processes serialize first-time issuance and recover expired credentials on requests", async (t) => {
  const f = await fixture(t);
  const code = `import {connection} from './dist/setup.js'; await connection(JSON.parse(process.env.TEST_CONFIG));`;
  const options = {
    cwd: process.cwd(),
    env: { ...process.env, TEST_CONFIG: JSON.stringify(f.config) },
  };
  await Promise.all([
    exec(process.execPath, ["--input-type=module", "-e", code], options),
    exec(process.execPath, ["--input-type=module", "-e", code], options),
  ]);
  assert.equal(f.issued(), 1);
  const c = await connection(f.config);
  const path = `${c.tokenFile}.managed.json`;
  const meta = JSON.parse(readFileSync(path, "utf8"));
  meta.expiresAt = new Date(0).toISOString();
  writeFileSync(path, JSON.stringify(meta));
  const old = readFileSync(c.tokenFile, "utf8");
  await Promise.all([
    new T3(f.origin, c.tokenFile).threads(),
    new T3(f.origin, c.tokenFile).threads(),
  ]);
  assert.equal(f.issued(), 2);
  assert.notEqual(readFileSync(c.tokenFile, "utf8"), old);
});

test("failed renewal and failed verification preserve the old credential without leaking CLI output", async (t) => {
  const f = await fixture(t);
  const c = await connection(f.config);
  const path = `${c.tokenFile}.managed.json`;
  const meta = JSON.parse(readFileSync(path, "utf8"));
  meta.expiresAt = new Date(0).toISOString();
  writeFileSync(path, JSON.stringify(meta));
  const before = readFileSync(c.tokenFile, "utf8");
  writeFileSync(join(f.base, "fail"), "");
  await assert.rejects(
    renewManaged(c.tokenFile, f.origin),
    (e) =>
      e instanceof Error &&
      !e.message.includes("secret-that") &&
      e.message.includes("preserved"),
  );
  assert.equal(readFileSync(c.tokenFile, "utf8"), before);
  rmSync(join(f.base, "fail"));
  writeFileSync(join(f.base, "reject"), "");
  await assert.rejects(renewManaged(c.tokenFile, f.origin), /preserved/);
  assert.equal(readFileSync(c.tokenFile, "utf8"), before);
});

test("stale or mismatched process state is rejected; manual configuration never issues credentials", async (t) => {
  const f = await fixture(t);
  const path = join(f.base, "userdata/server-runtime.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.pid = process.pid;
  writeFileSync(path, JSON.stringify(state));
  assert.equal(inspectLocal(f.base), undefined);
  await assert.rejects(connection(f.config), /No supported local/);
  assert.deepEqual(
    await connection({
      ...f.config,
      origin: f.origin,
      tokenFile: "/manual/token",
    }),
    { origin: f.origin, tokenFile: "/manual/token" },
  );
  await renewManaged("/manual/token", f.origin);
  const service = new Service(f.config);
  try {
    await service.list();
  } finally {
    service.close();
  }
  assert.equal(f.issued(), 0);
});

test("discovery reports ambiguity and accepts a URL selector", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const original = process.env.T3CODE_HOME;
  const cwd = process.cwd();
  const workspace = join(second.root, "workspace");
  mkdirSync(workspace);
  // A second independently configured instance appears in an ancestor .t3 directory.
  const { symlinkSync } = await import("node:fs");
  symlinkSync(second.base, join(workspace, ".t3"));
  process.env.T3CODE_HOME = first.base;
  process.chdir(workspace);
  try {
    assert.throws(() => discover({ home: first.home }), /Multiple local T3/);
    assert.equal(
      discover({ home: first.home, origin: second.origin }).baseDir,
      realpathSync(second.base),
    );
  } finally {
    process.chdir(cwd);
    if (original === undefined) delete process.env.T3CODE_HOME;
    else process.env.T3CODE_HOME = original;
  }
});

test("renewal starts before expiration, repairs a missing token, and recovers an expired setup lock", async (t) => {
  const f = await fixture(t);
  const c = await connection(f.config);
  const path = `${c.tokenFile}.managed.json`;
  const meta = JSON.parse(readFileSync(path, "utf8"));
  meta.expiresAt = new Date(Date.now() + 3600000).toISOString();
  writeFileSync(path, JSON.stringify(meta));
  const { DatabaseSync } = await import("node:sqlite");
  const { dirname } = await import("node:path");
  const db = new DatabaseSync(join(dirname(c.tokenFile), "setup.sqlite"));
  db.prepare("INSERT OR REPLACE INTO setup_lock VALUES(1,?,?)").run(
    "crashed-owner",
    0,
  );
  db.close();
  await renewManaged(c.tokenFile, f.origin);
  assert.equal(f.issued(), 2);
  rmSync(c.tokenFile);
  await new T3(f.origin, c.tokenFile).threads();
  assert.equal(f.issued(), 3);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a runtime file pointing at another T3 data directory cannot mint credentials", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  copyFileSync(
    join(first.base, "userdata/server-runtime.json"),
    join(second.base, "userdata/server-runtime.json"),
  );
  assert.equal(inspectLocal(second.base), undefined);
  await assert.rejects(connection(second.config), /No supported local/);
  assert.equal(first.issued(), 0);
  assert.equal(second.issued(), 0);
});

for (const launch of ["absolute-link", "relative-link"] as const) {
  test(`discovery and issuance work through a ${launch}`, async (t) => {
    const f = await fixture(t, launch);
    const c = await connection(f.config);
    assert.equal(c.origin, f.origin);
    assert.deepEqual(await new T3(c.origin, c.tokenFile).threads(), []);
    assert.equal(f.issued(), 1);
  });
}

test("proactive renewal failure keeps serving a valid token, backs off, and never bypasses expiration", async (t) => {
  const f = await fixture(t);
  const c = await connection(f.config);
  const path = `${c.tokenFile}.managed.json`;
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  metadata.expiresAt = new Date(Date.now() + 3600000).toISOString();
  writeFileSync(path, JSON.stringify(metadata));
  const token = readFileSync(c.tokenFile, "utf8");
  writeFileSync(join(f.base, "fail"), "");
  assert.deepEqual(await new T3(c.origin, c.tokenFile).threads(), []);
  const failed = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(failed.retryAfter > Date.now());
  assert.equal(readFileSync(c.tokenFile, "utf8"), token);
  assert.deepEqual(await connection(f.config), c);
  assert.equal(readFileSync(path, "utf8"), JSON.stringify(failed) + "\n");
  failed.expiresAt = new Date(0).toISOString();
  writeFileSync(path, JSON.stringify(failed));
  await assert.rejects(new T3(c.origin, c.tokenFile).threads(), /preserved/);
  rmSync(join(f.base, "fail"));
  assert.deepEqual(await new T3(c.origin, c.tokenFile).threads(), []);
  assert.notEqual(readFileSync(c.tokenFile, "utf8"), token);
});

test("worker requests repair empty and insecure managed token files before expiry", async (t) => {
  const f = await fixture(t);
  const c = await connection(f.config);
  writeFileSync(c.tokenFile, "");
  assert.deepEqual(await new T3(c.origin, c.tokenFile).threads(), []);
  assert.equal(f.issued(), 2);
  const { chmodSync } = await import("node:fs");
  chmodSync(c.tokenFile, 0o644);
  assert.deepEqual(await new T3(c.origin, c.tokenFile).threads(), []);
  assert.equal(f.issued(), 3);
  assert.equal(statSync(c.tokenFile).mode & 0o777, 0o600);
});

test("failed verification revokes its session and retries failed cleanup before issuing again", async (t) => {
  const f = await fixture(t);
  const c = await connection(f.config);
  const path = `${c.tokenFile}.managed.json`;
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  metadata.expiresAt = new Date(0).toISOString();
  writeFileSync(path, JSON.stringify(metadata));
  writeFileSync(join(f.base, "reject"), "");
  await assert.rejects(renewManaged(c.tokenFile, f.origin), /preserved/);
  const issuedId = readFileSync(join(f.base, "issued"), "utf8")
    .trim()
    .split("\n")[1]!
    .slice(5);
  assert.equal(readFileSync(join(f.base, "revoked"), "utf8").trim(), issuedId);
  assert.equal(existsSync(`${c.tokenFile}.pending-session.json`), false);
  writeFileSync(join(f.base, "fail-revoke"), "");
  await assert.rejects(renewManaged(c.tokenFile, f.origin), /preserved/);
  assert.equal(f.issued(), 3);
  assert.ok(existsSync(`${c.tokenFile}.pending-session.json`));
  await assert.rejects(renewManaged(c.tokenFile, f.origin), /preserved/);
  assert.equal(f.issued(), 3);
  rmSync(join(f.base, "fail-revoke"));
  rmSync(join(f.base, "reject"));
  await renewManaged(c.tokenFile, f.origin);
  assert.equal(f.issued(), 4);
  assert.equal(
    readFileSync(join(f.base, "revoked"), "utf8").trim().split("\n").length,
    2,
  );
  assert.equal(existsSync(`${c.tokenFile}.pending-session.json`), false);
});
