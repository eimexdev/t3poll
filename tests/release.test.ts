import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nightlyVersion,
  stableVersion,
  nightlyCommit,
} from "../scripts/release.mjs";
test("nightlies are distinct prereleases and stable versions move forward", () => {
  assert.equal(
    nightlyVersion("0.1.0", new Date("2026-09-12T03:04:05Z")),
    "0.1.0-nightly.20260912030405",
  );
  assert.throws(() => nightlyVersion("0.1.0-nightly.1"));
  assert.equal(stableVersion("0.2.0", "0.1.9"), "0.2.0");
  for (const value of ["0.1.9", "0.1.8", "0.2.0-nightly.1", "v0.2.0", "01.2.3"])
    assert.throws(() => stableVersion(value, "0.1.9"));
});
test("stable promotion requires published nightly source metadata", () => {
  const commit = "a".repeat(40);
  assert.equal(
    nightlyCommit({
      version: "0.1.0-nightly.20260912030405",
      t3pollRelease: { commit, channel: "nightly" },
    }),
    commit,
  );
  for (const metadata of [
    {},
    { version: "0.1.0", t3pollRelease: { commit, channel: "nightly" } },
    {
      version: "0.1.0-nightly.1",
      t3pollRelease: { commit: "master", channel: "nightly" },
    },
  ])
    assert.throws(() => nightlyCommit(metadata));
});
