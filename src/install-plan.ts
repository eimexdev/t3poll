import { parseTOML } from "toml-eslint-parser";
import {
  disableGlobalEntry,
  expandInlineServers,
  recoverManagedEntry,
} from "./codex-config.js";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { privateDirectory, protectFile } from "./private-files.js";

const object = z.record(z.string(), z.unknown());
const configSchema = z
  .object({
    launchArgs: z.string().optional(),
    homePath: z.string().optional(),
    shadowHomePath: z.string().optional(),
    binaryPath: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();
export type Provider = {
  id: string;
  label: string;
  config: z.infer<typeof configSchema>;
  modern: boolean;
  environment: Record<string, string>;
};
export function providers(settings: Record<string, unknown>): Provider[] {
  const instances = object.parse(settings.providerInstances ?? {});
  const result: Provider[] = [];
  for (const [id, raw] of Object.entries(instances)) {
    const entry = object.parse(raw);
    if (entry.driver !== "codex" || entry.enabled === false) continue;
    const config = configSchema.parse(entry.config ?? {});
    const environment: Record<string, string> = {};
    for (const item of z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          sensitive: z.boolean().optional(),
          valueRedacted: z.boolean().optional(),
        }),
      )
      .parse(entry.environment ?? [])) {
      if (
        ["CODEX_HOME", "T3CODE_CODEX_LAUNCH_ARGS"].includes(item.name) &&
        (item.sensitive || item.valueRedacted)
      )
        throw new Error(
          `Provider ${id} has a protected ${item.name} override. Resolve it in T3 settings before setup.`,
        );
      if (!item.sensitive && !item.valueRedacted)
        environment[item.name] = item.value;
    }
    result.push({
      id,
      label: typeof entry.displayName === "string" ? entry.displayName : id,
      config,
      modern: true,
      environment,
    });
  }
  if (!("codex" in instances)) {
    const legacy = object.parse(settings.providers ?? {});
    const config = configSchema.parse(legacy.codex ?? {});
    if (config.enabled !== false)
      result.unshift({
        id: "codex",
        label: "Codex",
        config,
        modern: false,
        environment: {},
      });
  }
  return result;
}

// Matches T3's quote/escape rules, but rejects unclosed quotes rather than
// allowing an appended argument to become part of the preceding value.
export function tokenize(input: string): string[] {
  const result: string[] = [];
  let word = "",
    quote = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (c === quote) {
        quote = "";
        quoted = true;
      } else if (
        c === "\\" &&
        quote === '"' &&
        input[i + 1] &&
        ['"', "\\", "$", "`"].includes(input[i + 1]!)
      )
        word += input[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      quoted = true;
    } else if (/\s/.test(c)) {
      if (word || quoted) result.push(word);
      word = "";
      quoted = false;
    } else if (c === "\\" && input[i + 1] && /\s/.test(input[i + 1]!))
      word += input[++i];
    else word += c;
  }
  if (quote)
    throw new Error(
      "Launch arguments contain an unclosed quote. Fix it in T3 before setup.",
    );
  if (word || quoted) result.push(word);
  return result;
}
export function mergeLaunchArgs(input: string, server: string): string {
  const args = tokenize(input);
  const root = `mcp_servers.${server}`;
  let enabled = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--")
      throw new Error(
        "Launch arguments contain --; configuration flags cannot safely be appended after it.",
      );
    let setting: string | undefined;
    if (arg === "-c" || arg === "--config") {
      setting = args[++i];
      if (!setting || setting.startsWith("-"))
        throw new Error(
          "Launch arguments have a configuration flag without a value.",
        );
    } else if (arg.startsWith("--config=")) setting = arg.slice(9);
    else if (arg.startsWith("-c=")) setting = arg.slice(3);
    else if (arg.startsWith("-c") && arg.length > 2) setting = arg.slice(2);
    if (!setting) continue;
    // TOML parsing canonicalizes quoted/dotted keys and detects ancestor overrides.
    const equal = setting.indexOf("=");
    if (equal < 1)
      throw new Error(
        "Launch arguments contain a configuration override without key=value.",
      );
    let keys: string[] = [];
    let node: unknown;
    try {
      node = parse(`${setting.slice(0, equal)} = true`);
      while (node && typeof node === "object" && !Array.isArray(node)) {
        const entries = Object.entries(node);
        if (entries.length !== 1) break;
        keys.push(entries[0]![0]);
        node = entries[0]![1];
      }
    } catch {
      throw new Error("Launch arguments contain an invalid configuration key.");
    }
    if (keys[0] !== "mcp_servers") continue;
    if (
      keys.length === 1 ||
      (keys[1] === server &&
        !(
          keys.length === 3 &&
          keys[2] === "enabled" &&
          setting.slice(equal + 1).trim() === "true"
        ))
    ) {
      throw new Error(
        `Launch arguments override ${root} or its parent. Remove that override before setup; unrelated arguments can stay.`,
      );
    }
    if (keys[1] === server) enabled = true;
  }
  return enabled
    ? input
    : `${input.trimEnd()}${input.trim() ? " " : ""}-c ${root}.enabled=true`;
}
export function releaseChannel(version: string): "latest" | "nightly" {
  if (/^\d+\.\d+\.\d+$/.test(version)) return "latest";
  if (/^\d+\.\d+\.\d+-nightly[.\d-]*$/.test(version)) return "nightly";
  throw new Error(
    `No release channel is defined for package version ${version}.`,
  );
}
export function expandPath(
  path: string,
  cwd = process.cwd(),
  home = homedir(),
): string {
  return resolve(
    cwd,
    path === "~"
      ? home
      : /^~[\\/]/.test(path)
        ? join(home, path.slice(2))
        : path,
  );
}
export function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
export type Edit = { path: string; before: string | undefined; after: string };
export type InstallPlan = {
  server: string;
  channel: string;
  provider: Provider;
  codexHome: string;
  stateHome: string;
  edits: Edit[];
  launchArgs: string;
  environmentBlocked: boolean;
  globalEnvironmentScope: boolean;
  legacyGlobalEnabled: boolean;
  disablesLegacy: boolean;
  command: string;
  args: string[];
  baseDir: string;
};
export function planInstall(input: {
  baseDir: string;
  providerId: string;
  stateHome: string;
  version: string;
  command: string;
  args: string[];
  processEnv?: Record<string, string>;
  processCwd?: string;
  codexHome?: string;
  disableLegacy?: boolean;
}): InstallPlan {
  const baseDir = realpathSync(input.baseDir);
  const settingsPath = join(baseDir, "userdata", "settings.json");
  const before = readOptional(settingsPath);
  const settings = object.parse(JSON.parse(before ?? "{}"));
  const provider = providers(settings).find((p) => p.id === input.providerId);
  if (!provider)
    throw new Error(
      "The selected Codex configuration is no longer available. Run setup again.",
    );
  const environment = { ...input.processEnv, ...provider.environment };
  const userHome = environment.USERPROFILE || environment.HOME || homedir();
  const cwd = input.processCwd ?? baseDir;
  const codexHome = expandPath(
    input.codexHome ||
      provider.config.homePath ||
      (provider.config.shadowHomePath ? undefined : environment.CODEX_HOME) ||
      join(userHome, ".codex"),
    cwd,
    userHome,
  );
  const stateHome = resolve(input.stateHome);
  const server = `t3poll_${createHash("sha256").update(`${baseDir}\n${provider.id}`).digest("hex").slice(0, 12)}`;
  const saved = provider.config.launchArgs ?? "";
  const launchArgs = mergeLaunchArgs(saved, server);
  const override = environment.T3CODE_CODEX_LAUNCH_ARGS?.trim();
  const globalEnvironmentScope =
    !!override &&
    !provider.environment.T3CODE_CODEX_LAUNCH_ARGS?.trim() &&
    providers(settings).length > 1;
  const environmentBlocked =
    globalEnvironmentScope ||
    (!!override && mergeLaunchArgs(override, server) !== override);
  if (provider.modern) {
    const instances = object.parse(settings.providerInstances);
    const entry = object.parse(instances[provider.id]);
    instances[provider.id] = {
      ...entry,
      config: {
        ...provider.config,
        launchArgs,
        ...(input.codexHome ? { homePath: codexHome } : {}),
      },
    };
    settings.providerInstances = instances;
  } else {
    settings.providers = {
      ...object.parse(settings.providers ?? {}),
      codex: {
        ...provider.config,
        launchArgs,
        ...(input.codexHome ? { homePath: codexHome } : {}),
      },
    };
  }
  let configPath = join(codexHome, "config.toml");
  if (existsSync(configPath)) configPath = realpathSync(configPath);
  const configBefore = readOptional(configPath);
  const originalSource = configBefore ?? "";
  const originalServers = object.parse(parse(originalSource).mcp_servers ?? {});
  const legacyGlobalEnabled =
    !!originalServers.t3poll &&
    object.parse(originalServers.t3poll).enabled !== false;
  const disablesLegacy = legacyGlobalEnabled && input.disableLegacy !== false;
  let source = expandInlineServers(
    disablesLegacy ? disableGlobalEntry(originalSource) : originalSource,
  );

  const start = `# t3poll managed ${server} begin`;
  const end = `# t3poll managed ${server} end`;
  const comments = parseTOML(source).comments;
  const starts = comments.filter((c) => source.slice(...c.range) === start);
  const ends = comments.filter((c) => source.slice(...c.range) === end);
  let startIndex = starts[0]?.range[0] ?? -1,
    endIndex = ends[0]?.range[0] ?? -1;
  const damaged =
    startIndex < 0 !== endIndex < 0 ||
    (startIndex >= 0 &&
      (endIndex < startIndex || starts.length > 1 || ends.length > 1));
  if (damaged) {
    source = recoverManagedEntry(source, server);
    startIndex = -1;
    endIndex = -1;
  }
  const entries = object.parse(parse(source).mcp_servers ?? {});
  if (startIndex >= 0 && endIndex > startIndex) {
    if (
      (startIndex > 0 && source[startIndex - 1] !== "\n") ||
      (endIndex > 0 && source[endIndex - 1] !== "\n")
    )
      throw new Error("Invalid t3poll config block boundaries.");
    const managed = parse(source.slice(startIndex + start.length, endIndex));
    const ownEntries = object.parse(managed.mcp_servers ?? {});
    if (
      Object.keys(managed).some((key) => key !== "mcp_servers") ||
      Object.keys(ownEntries).some((key) => key !== server)
    )
      throw new Error(
        "The t3poll managed block contains unrelated settings. Move them outside the block before setup.",
      );
  }

  if (entries[server] && startIndex < 0)
    throw new Error(
      `Codex already has an unmanaged ${server} entry. Rename or remove it before setup.`,
    );
  const channel = releaseChannel(input.version);
  const block = `${start}\n${stringify({ mcp_servers: { [server]: { enabled: false, command: input.command, args: input.args, startup_timeout_sec: 120, env: { T3POLL_BASE_DIR: baseDir, T3POLL_HOME: stateHome, T3POLL_URL: "", T3POLL_TOKEN_FILE: "", T3POLL_THREAD_ID: "" } } } })}${end}\n`;
  const configAfter =
    startIndex >= 0
      ? source.slice(0, startIndex) +
        block +
        source.slice(endIndex + end.length).replace(/^\r?\n/, "")
      : source + (source.endsWith("\n") || !source ? "" : "\n") + "\n" + block;
  parse(configAfter);
  const edits = [
    { path: configPath, before: configBefore, after: configAfter },
    {
      path: settingsPath,
      before,
      after: `${JSON.stringify(settings, null, 2)}\n`,
    },
  ];
  return {
    server,
    channel,
    provider,
    codexHome,
    stateHome,
    edits,
    launchArgs,
    environmentBlocked,
    globalEnvironmentScope,
    legacyGlobalEnabled,
    disablesLegacy,
    command: input.command,
    args: input.args,
    baseDir,
  };
}

function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
    protectFile(tmp);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
// Compare against the reviewed snapshot, back up originals, and roll back only
// our own writes. Never overwrite a concurrent user/T3 edit during rollback.
export function applyPlan(plan: InstallPlan): {
  backups: string[];
  rollback: () => void;
} {
  if (plan.environmentBlocked)
    throw new Error(
      "T3's launch environment overrides its saved settings. Update or remove T3CODE_CODEX_LAUNCH_ARGS and restart T3, then rerun setup.",
    );
  const changed = plan.edits.filter((e) => e.before !== e.after);
  const written: Edit[] = [],
    backups: string[] = [];
  const locks: string[] = [];
  const rollback = () => {
    for (const e of [...written].reverse()) {
      if (readOptional(e.path) !== e.after)
        throw new Error(
          `Configuration changed during setup. Restore manually using the backup for ${e.path}.`,
        );
      if (e.before === undefined) rmSync(e.path);
      else writeAtomic(e.path, e.before);
    }
  };
  try {
    for (const e of [...changed].sort((a, b) => a.path.localeCompare(b.path))) {
      privateDirectory(dirname(e.path));
      const lock = `${e.path}.t3poll-lock`;
      writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
      locks.push(lock);
      if (existsSync(e.path) && lstatSync(e.path).isSymbolicLink())
        throw new Error(`Configuration path changed to a symlink: ${e.path}`);
      if (readOptional(e.path) !== e.before)
        throw new Error(
          "Configuration changed while reviewing setup. Run setup again.",
        );
      if (e.before !== undefined) {
        const backup = `${e.path}.t3poll-${randomUUID()}.bak`;
        writeFileSync(backup, e.before, { flag: "wx", mode: 0o600 });
        protectFile(backup);
        backups.push(backup);
      }
    }
    for (const e of changed) {
      if (readOptional(e.path) !== e.before)
        throw new Error("Configuration changed during setup. Run setup again.");
      writeAtomic(e.path, e.after);
      written.push(e);
    }
  } catch (error) {
    rollback();
    throw error;
  } finally {
    for (const lock of locks) rmSync(lock, { force: true });
  }
  return { backups, rollback };
}
