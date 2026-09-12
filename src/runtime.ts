import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Runtime = { version: string; cli: string; node: string };
export const runtime: Runtime = {
  version: JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version,
  cli: fileURLToPath(new URL("./cli.js", import.meta.url)),
  node: process.execPath,
};

// Published versions are stable triples or timestamped nightlies. Unknown development
// versions never displace a running release.
export function newer(a: string, b: string): boolean {
  const parse = (v: string) =>
    /^(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$/.exec(v);
  const x = parse(a),
    y = parse(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) {
    if (BigInt(x[i]!) !== BigInt(y[i]!)) return BigInt(x[i]!) > BigInt(y[i]!);
  }
  if (!x[4] || !y[4]) return !x[4] && !!y[4];
  return BigInt(x[4]) > BigInt(y[4]);
}
