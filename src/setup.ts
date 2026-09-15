import { privateDirectory, protectFile } from "./private-files.js";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  readFileSync,
  realpathSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { readToken, validateOrigin, type Config } from "./config.js";
import { readLocalProcess, hasOpenFile } from "./local-process.js";

const exec = promisify(execFile);
const runtimeSchema = z.object({
  version: z.literal(1),
  pid: z.number().int().positive(),
  origin: z.string(),
  devUrl: z.string().optional(),
});
const managedSchema = z.object({
  baseDir: z.string(),
  origin: z.string(),
  expiresAt: z.string().datetime(),
  sessionId: z.string(),
  retryAfter: z.number().optional(),
});
type Managed = z.infer<typeof managedSchema>;
export type LocalT3 = {
  baseDir: string;
  origin: string;
  node: string;
  cli: string;
  native?: boolean;
  electron?: boolean;
};
const renewalWindow = 24 * 60 * 60 * 1000;
function canReuse(metadata: Managed): boolean {
  const now = Date.now();
  return (
    Date.parse(metadata.expiresAt) > now &&
    (Date.parse(metadata.expiresAt) > now + renewalWindow ||
      (metadata.retryAfter ?? 0) > now)
  );
}

export function candidateHomes(config: Config): string[] {
  if (config.baseDir) return [config.baseDir];
  const homes = new Set([
    resolve(process.env.T3CODE_HOME ?? join(homedir(), ".t3")),
  ]);
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    homes.add(join(dir, ".t3"));
    if (dir === dirname(dir)) break;
  }
  return [...homes];
}

// Verify the live process and its data directory, not just a possibly stale port file.
export function inspectLocal(baseDir: string): LocalT3 | undefined {
  try {
    const state = runtimeSchema.parse(
      JSON.parse(
        readFileSync(join(baseDir, "userdata/server-runtime.json"), "utf8"),
      ),
    );
    const { args, env, cwd, executable } = readLocalProcess(state.pid);
    if (!args[1] || args.includes("auth")) return;
    let cli: string;
    const resources =
      process.platform === "darwin"
        ? join(dirname(dirname(executable)), "Resources")
        : join(dirname(executable), "resources");
    const archive = ["server.asar", "app.asar"]
      .map((name) => join(resources, name))
      .find((path) => args[1] === join(path, "apps/server/dist/bin.mjs"));
    const electron =
      (process.platform === "darwin" || process.platform === "win32") &&
      env.ELECTRON_RUN_AS_NODE === "1" &&
      archive !== undefined;
    if (electron) {
      cli = join(archive!, "apps/server/dist/bin.mjs");
      const name = execFileSync(
        executable,
        [
          "-e",
          "process.stdout.write(require(process.argv[1]).name)",
          join(archive!, "package.json"),
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      if (name !== "t3code" && name !== "t3code-server") return;
      // Desktop bootstrap may pass its home through a pipe. Verify the live
      // process has this home's database open before running its auth CLI.
      if (!hasOpenFile(state.pid, join(baseDir, "userdata/state.sqlite")))
        return;
    } else if (args[1] === "serve") {
      // Native npm distributions run `t3 serve`, with no JS entrypoint.
      // Verify the live executable against its platform package before using
      // that same executable to issue or revoke credentials.
      const pkg = JSON.parse(
        readFileSync(join(dirname(executable), "package.json"), "utf8"),
      );
      // Setup's Node may run under emulation while T3 uses the host CPU.
      if (
        !["x64", "arm64"].some(
          (arch) => pkg.name === `@t3code/t3-${process.platform}-${arch}`,
        )
      )
        return;
      const binary = process.platform === "win32" ? "t3.exe" : "t3";
      if (executable !== join(dirname(executable), binary)) return;
      cli = executable;
    } else {
      cli = realpathSync(resolve(cwd, args[1]));
      if (!cli.endsWith(join("dist", "bin.mjs"))) return;
      const pkg = JSON.parse(
        readFileSync(join(dirname(cli), "../package.json"), "utf8"),
      );
      if (pkg.name !== "t3") return;
    }
    const flagIndex = args.indexOf("--base-dir");
    const baseFlag = args
      .find((arg) => arg.startsWith("--base-dir="))
      ?.slice(11);
    const processHome =
      baseFlag ??
      (flagIndex >= 0 ? args[flagIndex + 1] : undefined) ??
      env.T3CODE_HOME ??
      join(
        (process.platform === "win32" ? env.USERPROFILE : env.HOME) ??
          homedir(),
        ".t3",
      );
    if (
      !electron &&
      realpathSync(resolve(cwd, processHome)) !== realpathSync(baseDir)
    )
      return;
    // Automatic issuance currently targets the released userdata layout only.
    const origin = validateOrigin(state.origin);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname))
      return;
    return {
      baseDir: realpathSync(baseDir),
      origin,
      node: executable,
      cli,
      ...(electron ? { electron: true } : {}),
      ...(args[1] === "serve" ? { native: true } : {}),
    };
  } catch {
    return;
  }
}

export function discover(config: Config): LocalT3 {
  const candidates = new Map<string, LocalT3>();
  for (const home of candidateHomes(config)) {
    const server = inspectLocal(home);
    if (server && (!config.origin || server.origin === config.origin))
      candidates.set(server.baseDir, server);
  }
  if (candidates.size === 1) return [...candidates.values()][0]!;
  if (!candidates.size)
    throw new Error(
      "No supported local T3 server found. Start T3, or set T3POLL_BASE_DIR to its home. Development/other layouts can use T3POLL_URL and T3POLL_TOKEN_FILE.",
    );
  throw new Error(
    `Multiple local T3 servers found. Set T3POLL_BASE_DIR to one of: ${[...candidates.keys()].join(", ")}`,
  );
}

function atomic(path: string, content: string) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    protectFile(temp);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

async function withLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  privateDirectory(directory);
  const path = join(directory, "setup.sqlite");
  const db = new DatabaseSync(path);
  protectFile(path);
  db.exec(
    "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS setup_lock (id INTEGER PRIMARY KEY, owner TEXT, expires INTEGER)",
  );
  const owner = randomUUID();
  const deadline = Date.now() + 60_000;
  try {
    while (
      !db
        .prepare(
          "INSERT INTO setup_lock VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires < ?",
        )
        .run(owner, Date.now() + 120_000, Date.now()).changes
    ) {
      if (Date.now() > deadline)
        throw new Error("T3 setup is already in progress. Retry shortly.");
      await delay(100);
    }
    return await operation();
  } finally {
    db.prepare("DELETE FROM setup_lock WHERE owner=?").run(owner);
    db.close();
  }
}

async function verify(origin: string, token: string): Promise<void> {
  const response = await fetch(`${origin}/api/orchestration/shell`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Credential verification failed.");
  }
  z.object({ threads: z.array(z.unknown()) }).parse(await response.json());
}

async function issue(
  server: LocalT3,
  tokenFile: string,
): Promise<{ token: string; metadata: Managed }> {
  const pendingPath = `${tokenFile}.pending-session.json`;
  let sessionId: string | undefined;
  // Pin userdata and clear development settings inherited from an unrelated shell.
  const env = { ...process.env };
  delete env.VITE_DEV_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  if (server.electron) env.ELECTRON_RUN_AS_NODE = "1";
  env.T3CODE_HOME = server.baseDir;
  const cleanup = async () => {
    if (!sessionId) return;
    await exec(
      server.node,
      [
        ...(server.native ? [] : [server.cli]),
        "auth",
        "session",
        "revoke",
        sessionId,
        "--base-dir",
        server.baseDir,
      ],
      { env, timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true },
    );
    rmSync(pendingPath, { force: true });
    sessionId = undefined;
  };
  try {
    if (existsSync(pendingPath)) {
      sessionId = z
        .object({ sessionId: z.string().min(1) })
        .parse(JSON.parse(readFileSync(pendingPath, "utf8"))).sessionId;
      await cleanup();
    }
    const { stdout } = await exec(
      server.node,
      [
        ...(server.native ? [] : [server.cli]),
        "auth",
        "session",
        "issue",
        "--base-dir",
        server.baseDir,
        "--label",
        "t3poll",
        "--ttl",
        "30d",
        "--json",
      ],
      { env, timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true },
    );
    const issued = z
      .object({
        token: z.string().min(1).regex(/^\S+$/),
        sessionId: z.string(),
        expiresAt: z.string().datetime(),
      })
      .parse(JSON.parse(stdout));
    sessionId = issued.sessionId;
    atomic(pendingPath, JSON.stringify({ sessionId }));
    if (Date.parse(issued.expiresAt) <= Date.now() + renewalWindow)
      throw new Error("Invalid lifetime");
    await verify(server.origin, issued.token);
    return {
      token: issued.token,
      metadata: {
        baseDir: server.baseDir,
        origin: server.origin,
        sessionId: issued.sessionId,
        expiresAt: issued.expiresAt,
      },
    };
  } catch {
    // Keep the record when revocation fails; the next attempt cleans up before issuing.
    await cleanup().catch(() => {});
    throw new Error(
      "Could not create and verify a T3 credential. Check the local T3 installation and its auth CLI. Existing credentials were preserved.",
    );
  }
}

async function ensureCredential(
  tokenFile: string,
  origin: string,
  initial?: LocalT3,
): Promise<void> {
  await withLock(dirname(tokenFile), async () => {
    const metaPath = `${tokenFile}.managed.json`;
    let metadata: Managed | undefined;
    if (existsSync(metaPath))
      metadata = managedSchema.parse(
        JSON.parse(readFileSync(metaPath, "utf8")),
      );
    if (metadata && metadata.origin !== origin)
      throw new Error("Managed T3 credential belongs to a different server.");
    if (metadata && canReuse(metadata)) {
      try {
        readToken(tokenFile);
        return;
      } catch {
        /* Replace missing or unreadable managed credentials. */
      }
    }
    try {
      const server =
        initial ?? (metadata ? inspectLocal(metadata.baseDir) : undefined);
      if (!server || server.origin !== origin)
        throw new Error(
          "Cannot renew credential: the selected local T3 server is unavailable or its address changed.",
        );
      const issued = await issue(server, tokenFile);
      atomic(tokenFile, `${issued.token}\n`);
      atomic(metaPath, `${JSON.stringify(issued.metadata)}\n`);
      rmSync(`${tokenFile}.pending-session.json`, { force: true });
    } catch (error) {
      if (!metadata || Date.parse(metadata.expiresAt) <= Date.now())
        throw error;
      // Proactive renewal must not interrupt delivery through a still-valid token.
      readToken(tokenFile);
      atomic(
        metaPath,
        `${JSON.stringify({ ...metadata, retryAfter: Date.now() + 5 * 60_000 })}\n`,
      );
    }
  });
}

// Called by both MCP and detached workers. Explicit credential files remain user-managed.
export async function renewManaged(
  tokenFile: string,
  origin: string,
): Promise<void> {
  if (!existsSync(`${tokenFile}.managed.json`)) return;
  const metadata = managedSchema.parse(
    JSON.parse(readFileSync(`${tokenFile}.managed.json`, "utf8")),
  );
  if (metadata.origin !== origin)
    throw new Error("Managed T3 credential belongs to a different server.");
  if (canReuse(metadata)) {
    try {
      readToken(tokenFile);
      return;
    } catch {
      /* Repair invalid managed files below. */
    }
  }
  await ensureCredential(tokenFile, origin);
}

export async function connection(
  config: Config,
): Promise<{ origin: string; tokenFile: string }> {
  if (config.tokenFile) {
    const origin = config.origin ?? discover(config).origin;
    return { origin, tokenFile: config.tokenFile };
  }
  const server = discover(config);
  const key = createHash("sha256")
    .update(`${server.baseDir}\n${server.origin}`)
    .digest("hex")
    .slice(0, 24);
  const tokenFile = join(config.home, "credentials", key, "token");
  await ensureCredential(tokenFile, server.origin, server);
  return { origin: server.origin, tokenFile };
}
