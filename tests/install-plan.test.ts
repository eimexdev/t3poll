import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "smol-toml";
import {
  applyPlan,
  planInstall,
  mergeLaunchArgs,
  providers,
  releaseChannel,
  tokenize,
} from "../src/install-plan.js";
import { assertPrivateFile } from "../src/private-files.js";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "t3poll install café space-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, "t3"),
    codex = join(root, "codex");
  mkdirSync(join(base, "userdata"), { recursive: true });
  mkdirSync(codex);
  const settings = join(base, "userdata/settings.json"),
    config = join(codex, "config.toml");
  const original =
    '# keep my comment\nmodel = "example"\n[mcp_servers.other]\ncommand = "other"\n';
  writeFileSync(config, original);
  writeFileSync(
    settings,
    JSON.stringify({
      unrelated: { keep: true },
      providers: {
        codex: {
          homePath: codex,
          launchArgs: '-c model_reasoning_effort="high"',
          customModels: [],
        },
      },
    }),
  );
  const input = {
    baseDir: base,
    providerId: "codex",
    stateHome: join(root, "state"),
    version: "0.1.0",
    command: process.execPath,
    args: [join(root, "cli.js"), "mcp"],
  };
  return { root, base, codex, settings, config, original, input };
}

test("ordinary arguments and quoting survive; reruns do not append duplicates", () => {
  const source = String.raw`--enable search -c 'model="some model"' --config=features.foo=true -c windows_path='C:\Users\Alex Name'`;
  const next = mergeLaunchArgs(source, "t3poll_abc");
  assert.equal(next, source + " -c mcp_servers.t3poll_abc.enabled=true");
  assert.equal(mergeLaunchArgs(next, "t3poll_abc"), next);
  assert.deepEqual(tokenize(next).slice(0, -2), tokenize(source));
  assert.equal(
    mergeLaunchArgs(
      `--config='mcp_servers."t3poll_abc".enabled=true'`,
      "t3poll_abc",
    ),
    `--config='mcp_servers."t3poll_abc".enabled=true'`,
  );
});
test("same-entry, parent, and unappendable overrides are conflicts", () => {
  for (const arg of [
    "-c mcp_servers.t3poll_abc.enabled=false",
    "-cmcp_servers.t3poll_abc.enabled=false",
    "-c=mcp_servers.t3poll_abc.command=other",
    "--config=mcp_servers={}",
    "-c mcp_servers.t3poll_abc={}",
    "-c",
    "--config -c foo=true",
    "--",
    `-c 'model=oops`,
    "-c malformed",
  ])
    assert.throws(() => mergeLaunchArgs(arg, "t3poll_abc"), undefined, arg);
  assert.doesNotThrow(() =>
    mergeLaunchArgs("-c mcp_servers.other.enabled=false", "t3poll_abc"),
  );
});
test("the package version determines its channel", () => {
  assert.equal(releaseChannel("1.2.3"), "latest");
  assert.equal(releaseChannel("1.2.3-nightly.20260911.1234"), "nightly");
  assert.throws(() => releaseChannel("1.2.3-beta.1"));
});
test("plans write nothing; apply preserves comments, backs up, scopes and reruns", (t) => {
  const f = fixture(t),
    before = readFileSync(f.settings, "utf8");
  const plan = planInstall(f.input);
  assert.equal(readFileSync(f.settings, "utf8"), before);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  assert.equal(existsSync(f.input.stateHome), false);
  const transaction = applyPlan(plan);
  assert.equal(transaction.backups.length, 2);
  for (const path of transaction.backups) assertPrivateFile(path);
  assert.ok(readFileSync(f.config, "utf8").startsWith(f.original));
  const servers = parse(readFileSync(f.config, "utf8")).mcp_servers as Record<
    string,
    any
  >;
  assert.equal(servers[plan.server].enabled, false);
  assert.equal(servers[plan.server].env.T3POLL_BASE_DIR, plan.baseDir);
  const settings = JSON.parse(readFileSync(f.settings, "utf8"));
  assert.equal(settings.unrelated.keep, true);
  assert.match(settings.providers.codex.launchArgs, /model_reasoning_effort/);
  assert.ok(
    settings.providers.codex.launchArgs.endsWith(
      `-c mcp_servers.${plan.server}.enabled=true`,
    ),
  );
  const second = planInstall(f.input);
  assert.ok(second.edits.every((e) => e.before === e.after));
  assert.deepEqual(applyPlan(second).backups, []);
  transaction.rollback();
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  assert.equal(readFileSync(f.settings, "utf8"), before);
});
test("two T3 homes sharing Codex configuration have separate destinations", (t) => {
  const f = fixture(t);
  const first = planInstall(f.input);
  applyPlan(first);
  const other = join(f.root, "other");
  mkdirSync(join(other, "userdata"), { recursive: true });
  writeFileSync(
    join(other, "userdata/settings.json"),
    JSON.stringify({ providers: { codex: { homePath: f.codex } } }),
  );
  const second = planInstall({ ...f.input, baseDir: other });
  applyPlan(second);
  assert.notEqual(first.server, second.server);
  const servers = parse(readFileSync(f.config, "utf8")).mcp_servers as Record<
    string,
    any
  >;
  assert.equal(servers[first.server].env.T3POLL_BASE_DIR, first.baseDir);
  assert.equal(servers[second.server].env.T3POLL_BASE_DIR, second.baseDir);
  assert.equal(servers[first.server].enabled, false);
  assert.equal(servers[second.server].enabled, false);
});
test("explicit provider instances win and preserve other providers", (t) => {
  const f = fixture(t);
  writeFileSync(
    f.settings,
    JSON.stringify({
      providers: { codex: { launchArgs: "legacy" } },
      providerInstances: {
        codex: { driver: "codex", enabled: false },
        work: {
          driver: "codex",
          displayName: "Work",
          config: { homePath: f.codex, launchArgs: "--enable search" },
        },
        other: { driver: "claudeAgent", config: { keep: true } },
      },
    }),
  );
  const available = providers(JSON.parse(readFileSync(f.settings, "utf8")));
  assert.deepEqual(
    available.map((p) => p.id),
    ["work"],
  );
  const plan = planInstall({ ...f.input, providerId: "work" });
  applyPlan(plan);
  const after = JSON.parse(readFileSync(f.settings, "utf8"));
  assert.equal(after.providers.codex.launchArgs, "legacy");
  assert.equal(after.providerInstances.other.config.keep, true);
  assert.match(
    after.providerInstances.work.config.launchArgs,
    /^--enable search -c/,
  );
});
test("live environment overrides block ineffective writes unless already enabled", (t) => {
  const f = fixture(t);
  const base = planInstall(f.input);
  const blocked = planInstall({
    ...f.input,
    processEnv: { T3CODE_CODEX_LAUNCH_ARGS: "--enable search" },
  });
  assert.equal(blocked.environmentBlocked, true);
  assert.throws(() => applyPlan(blocked), /launch environment/);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  const compatible = planInstall({
    ...f.input,
    processEnv: {
      T3CODE_CODEX_LAUNCH_ARGS: `--enable search -c mcp_servers.${base.server}.enabled=true`,
    },
  });
  assert.equal(compatible.environmentBlocked, false);
});
test("stale review and concurrent rollback cannot overwrite another edit", (t) => {
  const f = fixture(t),
    plan = planInstall(f.input);
  writeFileSync(f.settings, '{"userEdit":true}');
  assert.throws(() => applyPlan(plan), /changed while reviewing/);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  const next = planInstall({ ...f.input, codexHome: f.codex });
  const transaction = applyPlan(next);
  writeFileSync(f.settings, '{"newerEdit":true}');
  assert.throws(() => transaction.rollback(), /changed during setup/);
  assert.equal(readFileSync(f.settings, "utf8"), '{"newerEdit":true}');
});
test("invalid TOML, global legacy registrations and unmanaged collisions are not overwritten", (t) => {
  const f = fixture(t),
    plan = planInstall(f.input);
  for (const source of [
    "invalid = [",
    '[mcp_servers.t3poll]\ncommand="old"\n',
    `[mcp_servers.${plan.server}]\ncommand="mine"\n`,
  ]) {
    writeFileSync(f.config, source);
    assert.throws(() => planInstall(f.input));
    assert.equal(readFileSync(f.config, "utf8"), source);
  }
});

test("a global launch override cannot silently enable multiple providers", (t) => {
  const f = fixture(t);
  const settings = JSON.parse(readFileSync(f.settings, "utf8"));
  settings.providerInstances = {
    work: { driver: "codex", config: { homePath: f.codex } },
  };
  writeFileSync(f.settings, JSON.stringify(settings));
  const initial = planInstall(f.input);
  const env = {
    T3CODE_CODEX_LAUNCH_ARGS: `-c mcp_servers.${initial.server}.enabled=true`,
  };
  const global = planInstall({ ...f.input, processEnv: env });
  assert.equal(global.globalEnvironmentScope, true);
  assert.throws(() => applyPlan(global), /launch environment/);
  settings.providerInstances.codex = {
    driver: "codex",
    config: settings.providers.codex,
    environment: [
      { name: "T3CODE_CODEX_LAUNCH_ARGS", value: env.T3CODE_CODEX_LAUNCH_ARGS },
    ],
  };
  writeFileSync(f.settings, JSON.stringify(settings));
  assert.equal(
    planInstall({ ...f.input, processEnv: env }).environmentBlocked,
    false,
  );
});

test("unrelated settings inserted into a managed block cannot be deleted on repair", (t) => {
  const f = fixture(t),
    plan = planInstall(f.input);
  applyPlan(plan);
  const text = readFileSync(f.config, "utf8").replace(
    `# t3poll managed ${plan.server} end`,
    `[mcp_servers.personal]\ncommand = "keep"\n# t3poll managed ${plan.server} end`,
  );
  writeFileSync(f.config, text);
  assert.throws(() => planInstall(f.input), /unrelated settings/);
  assert.equal(readFileSync(f.config, "utf8"), text);
});
