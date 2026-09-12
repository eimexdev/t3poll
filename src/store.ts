import { privateDirectory, protectFile } from "./private-files.js";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Watch } from "./model.js";
import { newer, type Runtime } from "./runtime.js";

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly home: string) {
    privateDirectory(home);
    const path = join(home, "state.sqlite");
    this.db = new DatabaseSync(path);
    protectFile(path);
    this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1)
      throw new Error("Unsupported t3poll database version.");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, watch_key TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, pid INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_target (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS worker_runtime (owner TEXT PRIMARY KEY, version TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  all(): Watch[] {
    return this.db
      .prepare("SELECT data FROM watches ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(String(row.data)) as Watch);
  }
  get(id: string): Watch | undefined {
    const row = this.db.prepare("SELECT data FROM watches WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.data)) as Watch) : undefined;
  }
  add(watch: Watch): Watch {
    this.db
      .prepare("INSERT OR IGNORE INTO watches VALUES (?, ?, ?, ?)")
      .run(watch.id, watch.key, watch.revision, JSON.stringify(watch));
    const row = this.db
      .prepare("SELECT data FROM watches WHERE watch_key=?")
      .get(watch.key)!;
    return JSON.parse(String(row.data)) as Watch;
  }
  save(watch: Watch): boolean {
    const next = { ...watch, revision: watch.revision + 1 };
    const result = this.db
      .prepare(
        "UPDATE watches SET data=?, revision=? WHERE id=? AND revision=?",
      )
      .run(JSON.stringify(next), next.revision, watch.id, watch.revision);
    if (Number(result.changes) > 0) {
      watch.revision = next.revision;
      return true;
    }
    return false;
  }
  stop(id: string): Watch {
    const watch = this.get(id);
    if (!watch)
      throw new Error(`Unknown watch ${id}. Use list to find its ID.`);
    watch.status = "stopped";
    watch.pending = [];
    watch.command = null;
    if (!this.save(watch)) return this.stop(id);
    return watch;
  }
  work(): Watch[] {
    return this.all().filter(
      (w) => w.status === "watching" || w.status === "finishing",
    );
  }
  target(): Runtime | undefined {
    const row = this.db
      .prepare("SELECT data FROM runtime_target WHERE id=1")
      .get();
    return row ? (JSON.parse(String(row.data)) as Runtime) : undefined;
  }
  offer(runtime: Runtime): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.target();
      if (
        !previous ||
        runtime.version === previous.version ||
        newer(runtime.version, previous.version)
      )
        this.db
          .prepare(
            "INSERT INTO runtime_target VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          )
          .run(JSON.stringify(runtime));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  lease(owner: string, pid: number, now: number, version?: string): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO worker VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,pid=excluded.pid,expires=excluded.expires WHERE worker.expires < ? OR worker.owner=?`,
      )
      .run(owner, pid, now + 60_000, now, owner);
    if (Number(result.changes) > 0 && version)
      this.db
        .prepare("INSERT OR REPLACE INTO worker_runtime VALUES(?,?)")
        .run(owner, version);
    return Number(result.changes) > 0;
  }
  owns(owner: string): boolean {
    return (
      this.db.prepare("SELECT owner FROM worker WHERE id=1").get()?.owner ===
      owner
    );
  }
  worker(): { pid: number; expires: number; version?: string } | undefined {
    const row = this.db
      .prepare(
        "SELECT pid,expires,version FROM worker LEFT JOIN worker_runtime USING(owner) WHERE id=1",
      )
      .get();
    return row
      ? {
          pid: Number(row.pid),
          expires: Number(row.expires),
          ...(row.version ? { version: String(row.version) } : {}),
        }
      : undefined;
  }
  release(owner: string): void {
    this.db.prepare("DELETE FROM worker WHERE owner=?").run(owner);
    this.db.prepare("DELETE FROM worker_runtime WHERE owner=?").run(owner);
  }
  retire(owner: string): boolean {
    return (
      Number(
        this.db
          .prepare(
            `DELETE FROM worker WHERE owner=? AND NOT EXISTS (SELECT 1 FROM watches WHERE json_extract(data, '$.status') IN ('watching','finishing'))`,
          )
          .run(owner).changes,
      ) > 0
    );
  }
  clearDeadWorker(pid: number): void {
    this.db.prepare("DELETE FROM worker WHERE pid=?").run(pid);
  }
  close(): void {
    this.db.close();
  }
}
