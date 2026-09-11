// Local process/credential fixture. Copied into a temporary t3 package by setup tests.
import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const base = process.env.T3CODE_HOME;
if (process.argv.includes("auth")) {
  if (existsSync(join(base, "fail"))) {
    console.error("secret-that-must-not-escape");
    process.exit(1);
  }
  if (process.argv.includes("revoke")) {
    if (existsSync(join(base, "fail-revoke"))) process.exit(1);
    appendFileSync(
      join(base, "revoked"),
      process.argv[process.argv.indexOf("revoke") + 1] + "\n",
    );
    process.exit(0);
  }
  const sessionId = randomUUID();
  const token = `test-${sessionId}`;
  appendFileSync(join(base, "issued"), `${token}\n`);
  console.log(
    JSON.stringify({
      token,
      sessionId,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    }),
  );
} else {
  mkdirSync(join(base, "userdata"), { recursive: true });
  const server = createServer((req, res) => {
    const tokens = existsSync(join(base, "issued"))
      ? readFileSync(join(base, "issued"), "utf8").trim().split("\n")
      : [];
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!tokens.includes(token) || existsSync(join(base, "reject"))) {
      res.writeHead(401).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ threads: [] }));
  });
  server.listen(0, "127.0.0.1", () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    writeFileSync(
      join(base, "userdata/server-runtime.json"),
      JSON.stringify({ version: 1, pid: process.pid, origin }),
    );
    console.log(origin);
  });
}
