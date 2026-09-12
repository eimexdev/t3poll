import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function nightlyVersion(base, date = new Date()) {
  if (!/^\d+\.\d+\.\d+$/.test(base))
    throw new Error("package.json must contain a stable base version");
  return `${base}-nightly.${date
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}`;
}
export function stableVersion(value, previous) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error("Use a stable version such as 0.1.0");
  if (previous) {
    const a = value.split(".").map(Number),
      b = previous.split(".").map(Number);
    const first = a.findIndex((n, i) => n !== b[i]);
    if (first < 0 || a[first] < b[first])
      throw new Error("Stable version must advance latest");
  }
  return value;
}
export function nightlyBase(base, latest) {
  if (!latest || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(latest))
    return base;
  try {
    stableVersion(base, latest);
    return base;
  } catch {
    const [major, minor, patch] = latest.split(".");
    return `${major}.${minor}.${BigInt(patch) + 1n}`;
  }
}
export function nightlyCommit(metadata) {
  const commit = metadata?.t3pollRelease?.commit;
  if (
    metadata?.t3pollRelease?.channel !== "nightly" ||
    !/^[0-9a-f]{40}$/.test(commit ?? "") ||
    !/^\d+\.\d+\.\d+-nightly\.\d+$/.test(metadata?.version ?? "")
  )
    throw new Error("Nightly has no valid source-commit metadata");
  return commit;
}
export function stamp(version, commit, channel) {
  if (
    !/^[0-9a-f]{40}$/.test(commit) ||
    !["nightly", "latest"].includes(channel)
  )
    throw new Error("Invalid release metadata");
  if (channel === "latest") stableVersion(version);
  else if (!/^\d+\.\d+\.\d+-nightly\.\d+$/.test(version))
    throw new Error("Nightly needs a nightly prerelease version");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  pkg.version = version;
  pkg.t3pollRelease = { commit, channel };
  writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  lock.version = version;
  lock.packages[""].version = version;
  writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
}
async function registry() {
  const response = await fetch("https://registry.npmjs.org/t3poll", {
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return { versions: {}, "dist-tags": {} };
  if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
  return response.json();
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "stamp") {
    stamp(...args);
    return;
  }
  if (command !== "resolve")
    throw new Error(
      "Usage: release.mjs resolve | stamp <version> <commit> <nightly|latest>",
    );
  const channel = process.env.RELEASE_CHANNEL || "nightly";
  if (!["nightly", "latest"].includes(channel))
    throw new Error("Invalid channel");
  const metadata = await registry();
  const nightly = metadata.versions[metadata["dist-tags"].nightly];
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const ref = channel === "latest" ? nightlyCommit(nightly) : head;
  if (channel === "latest")
    execFileSync("git", ["merge-base", "--is-ancestor", ref, head]);
  const base = JSON.parse(
    execFileSync("git", ["show", `${ref}:package.json`], { encoding: "utf8" }),
  ).version;
  const version =
    channel === "nightly"
      ? nightlyVersion(nightlyBase(base, metadata["dist-tags"].latest))
      : stableVersion(
          process.env.STABLE_VERSION || nightly.version.split("-")[0],
          /^\d+\.\d+\.\d+$/.test(metadata["dist-tags"].latest ?? "")
            ? metadata["dist-tags"].latest
            : undefined,
        );
  const skip =
    channel === "nightly" &&
    process.env.RELEASE_EVENT !== "workflow_dispatch" &&
    nightly?.t3pollRelease?.commit === ref;
  if (metadata.versions[version])
    throw new Error(
      "This version is already published. Retry with a new version.",
    );
  const result = { ref, version, channel, skip: String(skip) };
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(""),
    );
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
