import { assertPrivateFile } from "./private-files.js";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync, statSync } from "node:fs";

export type Config = {
  home: string;
  baseDir?: string;
  origin?: string;
  tokenFile?: string;
  threadId?: string;
};

export function configFromEnv(env = process.env): Config {
  return {
    home: resolve(
      env.T3POLL_HOME ?? join(homedir(), ".local", "share", "t3poll"),
    ),
    origin: env.T3POLL_URL ? validateOrigin(env.T3POLL_URL) : undefined,
    tokenFile: env.T3POLL_TOKEN_FILE
      ? resolve(env.T3POLL_TOKEN_FILE)
      : undefined,
    threadId: env.T3POLL_THREAD_ID,
    baseDir: env.T3POLL_BASE_DIR ? resolve(env.T3POLL_BASE_DIR) : undefined,
  };
}

export function validateOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "T3POLL_URL must be an HTTPS origin, or HTTP on localhost. No credentials, path, or query string.",
    );
  }
  return url.origin;
}

export function readToken(path: string): string {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 16_384) throw new Error("Invalid file");
    assertPrivateFile(path);
    const token = readFileSync(path, "utf8").trim();
    if (!token || /\s/.test(token)) throw new Error("Invalid token");
    return token;
  } catch {
    throw new Error(
      "Cannot read T3 credential. T3POLL_TOKEN_FILE must contain a bearer token in a private file (chmod 600 on Unix; current-user-only ACL on Windows).",
    );
  }
}
