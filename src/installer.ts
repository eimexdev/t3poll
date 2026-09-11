import * as p from "@clack/prompts";
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, delimiter } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { configFromEnv } from "./config.js";
import {
  candidateHomes,
  inspectLocal,
  connection,
  type LocalT3,
} from "./setup.js";
import { readLocalProcess } from "./local-process.js";
import { T3 } from "./t3.js";
import {
  applyPlan,
  planInstall,
  providers,
  readOptional,
  releaseChannel,
  expandPath,
  type InstallPlan,
} from "./install-plan.js";

const exec = promisify(execFile);
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
class Cancelled extends Error {}
async function answer<T>(prompt: Promise<T | symbol>): Promise<T> {
  const value = await prompt;
  if (p.isCancel(value)) throw new Cancelled();
  return value as T;
}
function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
    "/usr/share/nodejs/npm/bin/npm-cli.js",
  ];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const command = join(dir, process.platform === "win32" ? "npm.cmd" : "npm");
    if (existsSync(command)) {
      candidates.push(realpathSync(command));
      candidates.push(join(dir, "node_modules/npm/bin/npm-cli.js"));
    }
  }
  const found = candidates.find(
    (path) => path?.endsWith("npm-cli.js") && existsSync(path),
  );
  if (!found)
    throw new Error(
      "Cannot locate npm's npm-cli.js. Install Node.js with npm, then run setup again.",
    );
  return realpathSync(found);
}
function runtime(local: string | undefined): {
  command: string;
  args: string[];
} {
  if (local) {
    const cli = realpathSync(expandPath(local));
    return { command: process.execPath, args: [cli, "mcp"] };
  }
  return {
    command: process.execPath,
    args: [
      npmCli(),
      "exec",
      "--yes",
      `--package=t3poll@${releaseChannel(pkg.version)}`,
      "--",
      "t3poll",
      "mcp",
    ],
  };
}
async function checkCodex(
  plan: InstallPlan,
  environment: Record<string, string>,
  cwd: string,
): Promise<void> {
  const binary = plan.provider.config.binaryPath?.trim() || "codex";
  const expanded =
    binary.includes("/") || binary.includes("\\") || binary.startsWith("~")
      ? expandPath(binary, cwd, environment.USERPROFILE || environment.HOME)
      : binary;
  let command = expanded;
  let args = ["--version"];
  if (process.platform === "win32") {
    // npm's Windows Codex shim is a batch file. Launch its JS entry through
    // Node directly so neither spaces nor shell metacharacters need escaping.
    const dirs =
      expanded === "codex"
        ? (
            environment.PATH ||
            environment.Path ||
            process.env.PATH ||
            ""
          ).split(delimiter)
        : [dirname(expanded)];
    for (const dir of dirs) {
      const script = join(dir, "node_modules/@openai/codex/bin/codex.js");
      if (existsSync(script)) {
        command = process.execPath;
        args = [script, "--version"];
        break;
      }
      const native = join(dir, "codex.exe");
      if (expanded === "codex" && existsSync(native)) {
        command = native;
        break;
      }
    }
  }
  try {
    await exec(command, args, {
      cwd,
      env: { ...process.env, ...environment },
      timeout: 15_000,
      windowsHide: true,
    });
  } catch {
    throw new Error(
      "Cannot run the selected Codex executable. Install Codex or correct its binary path in T3 settings, then rerun setup.",
    );
  }
}
async function checkT3Support(server: LocalT3): Promise<void> {
  let supported: boolean;
  if (server.electron) {
    const { stdout } = await exec(
      server.node,
      [
        "-e",
        'process.stdout.write(String(require("node:fs").readFileSync(process.argv[1],"utf8").includes("T3CODE_CODEX_LAUNCH_ARGS")))',
        server.cli,
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        timeout: 15000,
        windowsHide: true,
      },
    );
    supported = stdout.trim() === "true";
  } else
    supported = readFileSync(server.cli, "utf8").includes(
      "T3CODE_CODEX_LAUNCH_ARGS",
    );
  if (!supported)
    throw new Error(
      "This T3 build could not be verified to support Codex launch arguments. Update T3 before T3-only setup.",
    );
}
function liveEnvironment(server: LocalT3) {
  const state = JSON.parse(
    readFileSync(join(server.baseDir, "userdata/server-runtime.json"), "utf8"),
  );
  return readLocalProcess(state.pid);
}
export async function verifyRuntime(plan: InstallPlan): Promise<void> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  Object.assign(env, {
    T3POLL_BASE_DIR: plan.baseDir,
    T3POLL_HOME: plan.stateHome,
    T3POLL_URL: "",
    T3POLL_TOKEN_FILE: "",
    T3POLL_THREAD_ID: "",
  });
  const client = new Client({ name: "t3poll-setup", version: pkg.version });
  const transport = new StdioClientTransport({
    command: plan.command,
    args: plan.args,
    env,
    stderr: "pipe",
  });
  // Drain child stderr without printing possible inherited configuration secrets.
  transport.stderr?.on("data", () => {});
  const timeout = setTimeout(() => {
    void transport.close();
  }, 120_000);
  try {
    await client.connect(transport);
    const result = await client.listTools();
    for (const name of ["watch", "list", "stop"])
      if (!result.tools.some((t) => t.name === name))
        throw new Error(`MCP runtime is missing ${name}.`);
  } catch {
    throw new Error(
      "MCP runtime verification failed. Check npm/network access, or use --runtime-path with a local build before the first npm release.",
    );
  } finally {
    clearTimeout(timeout);
    await client.close();
  }
}

export async function runSetup(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "base-dir": { type: "string" },
      provider: { type: "string" },
      "codex-home": { type: "string" },
      "state-home": { type: "string" },
      "runtime-path": { type: "string" },
      "dry-run": { type: "boolean" },
      yes: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length) throw new Error("Unexpected setup arguments.");
  if (values.help) {
    console.log(
      `t3poll setup [--base-dir <T3 home>] [--provider <id>] [--codex-home <path>]\n             [--state-home <path>] [--dry-run] [--yes]\n             [--runtime-path <built cli.js>]\n\nThe invoked package determines Stable or Nightly. --dry-run writes nothing.\n--runtime-path uses a local build instead of npm channel updates.\n--yes accepts the plan; ambiguous instances still require explicit selection.`,
    );
    return;
  }
  const interactive =
    !!process.stdin.isTTY && !!process.stdout.isTTY && !values.yes;
  if (!interactive && !values.yes && !values["dry-run"])
    throw new Error(
      "Run setup in a terminal, or use --yes with explicit selections. Use --dry-run to preview.",
    );
  try {
    if (interactive) p.intro("t3poll / setup");
    while (true) {
      try {
        await exec("gh", ["auth", "status"], {
          timeout: 15_000,
          windowsHide: true,
        });
        break;
      } catch {
        if (!interactive || values["dry-run"]) {
          if (values["dry-run"]) {
            console.log(
              "GitHub CLI is unavailable or not signed in. Run gh auth login before applying.",
            );
            break;
          }
          throw new Error(
            "GitHub CLI is unavailable or not signed in. Install gh, then run gh auth login in another terminal.",
          );
        }
        p.log.warn(
          "GitHub CLI is unavailable or not signed in. Install gh if needed, then run gh auth login in another terminal.",
        );
        if (
          !(await answer(
            p.confirm({ message: "Check again?", initialValue: true }),
          ))
        )
          throw new Cancelled();
      }
    }
    let selectedHome = values["base-dir"]
      ? expandPath(values["base-dir"])
      : undefined;
    let server: LocalT3 | undefined;
    while (!server) {
      const homes = selectedHome
        ? [selectedHome]
        : candidateHomes(configFromEnv());
      const found = [
        ...new Map(
          homes
            .map((h) => inspectLocal(h))
            .filter((s): s is LocalT3 => !!s)
            .map((s) => [s.baseDir, s]),
        ).values(),
      ];
      if (found.length === 1) server = found[0];
      else if (!interactive)
        throw new Error(
          found.length
            ? "Multiple T3 instances found. Pass --base-dir."
            : "No supported running T3 instance found. Open T3 and pass --base-dir if needed.",
        );
      else {
        if (found.length > 1) {
          const picked = await answer(
            p.select({
              message: "Which T3 instance?",
              options: [
                ...found.map((s) => ({
                  value: s.baseDir,
                  label: s.baseDir,
                  hint: s.origin,
                })),
                { value: "custom", label: "Enter another T3 data directory" },
              ],
            }),
          );
          if (picked !== "custom") {
            server = found.find((s) => s.baseDir === picked);
            continue;
          }
        } else
          p.log.warn(
            "No supported running T3 instance found. Open T3, then enter its data directory.",
          );
        selectedHome = expandPath(
          await answer(
            p.text({
              message: "T3 data directory",
              initialValue: selectedHome ?? homes[0],
              validate: (v) => (!v?.trim() ? "Enter a directory." : undefined),
            }),
          ),
        );
      }
    }
    await checkT3Support(server);
    let available = providers(
      JSON.parse(
        readOptional(join(server.baseDir, "userdata/settings.json")) ?? "{}",
      ),
    );
    if (!available.length)
      throw new Error("Enable a Codex provider in T3 before running setup.");
    let providerId = values.provider;
    if (!providerId) {
      if (available.length === 1) providerId = available[0]!.id;
      else if (!interactive)
        throw new Error(
          `Choose a Codex configuration with --provider: ${available.map((p) => p.id).join(", ")}`,
        );
      else
        providerId = await answer(
          p.select({
            message: "Which Codex configuration?",
            options: available.map((p) => ({
              value: p.id,
              label: p.label,
              hint: p.id,
            })),
          }),
        );
    }
    let codexHome = values["codex-home"];
    let stateHome = expandPath(values["state-home"] ?? configFromEnv().home);
    const launch = runtime(values["runtime-path"]);
    let plan: InstallPlan;
    while (true) {
      const live = liveEnvironment(server);
      plan = planInstall({
        baseDir: server.baseDir,
        providerId,
        stateHome,
        version: pkg.version,
        ...launch,
        processEnv: live.env,
        processCwd: live.cwd,
        ...(codexHome ? { codexHome } : {}),
      });
      const summary = [
        `T3: ${plan.baseDir}`,
        `Codex: ${plan.provider.label}`,
        `Config: ${plan.codexHome}`,
        `State: ${plan.stateHome}`,
        `Runtime: ${values["runtime-path"] ? "local build" : `t3poll@${plan.channel}`}`,
        `Scope: this T3 Codex configuration only`,
        `MCP entry: ${plan.server}`,
        ...plan.edits.map(
          (e) => `${e.before === e.after ? "Keep" : "Update"}: ${e.path}`,
        ),
      ].join("\n");
      if (interactive) p.note(summary, "Review your setup");
      else console.log(summary);
      if (plan.environmentBlocked) {
        const message = plan.globalEnvironmentScope
          ? "T3CODE_CODEX_LAUNCH_ARGS applies to multiple Codex configurations. Remove it from T3’s launch environment, or move it into the selected provider’s environment settings. Restart T3 and rerun setup."
          : `T3CODE_CODEX_LAUNCH_ARGS overrides saved launch arguments.\nKeep your existing arguments and add:\n-c mcp_servers.${plan.server}.enabled=true\nOr remove the environment override. Restart T3, then rerun setup.`;
        if (values["dry-run"]) {
          console.log(message);
          return;
        }
        throw new Error(message);
      }
      if (values["dry-run"]) {
        console.log("Dry run complete. No files or credentials changed.");
        return;
      }
      if (!interactive) break;
      const action = await answer(
        p.select({
          message: "Ready to set up t3poll?",
          options: [
            { value: "apply", label: "Set up t3poll" },
            { value: "edit", label: "Edit choices" },
            { value: "preview", label: "View proposed changes" },
            { value: "cancel", label: "Finish without applying" },
          ],
        }),
      );
      if (action === "cancel") throw new Cancelled();
      if (action === "apply") break;
      if (action === "preview") {
        p.note(
          `Back up changed configuration files.\nRegister ${plan.server} disabled by default.\nBind its connection to ${plan.baseDir}.\nPreserve existing launch arguments and enable only this MCP entry.\nCreate or reuse a managed credential and verify the connection.\nExisting conversations and watches keep running.`,
          "Proposed changes",
        );
      } else {
        const choice = await answer(
          p.select({
            message: "What would you like to change?",
            options: [
              { value: "instance", label: "T3 instance" },
              { value: "provider", label: "Codex configuration" },
              { value: "paths", label: "Configuration and state directories" },
              { value: "back", label: "Back to review" },
            ],
          }),
        );
        if (choice === "instance") {
          const directory = expandPath(
            await answer(
              p.text({
                message: "T3 data directory",
                initialValue: server.baseDir,
                validate: (v) =>
                  !v?.trim() ? "Enter a directory." : undefined,
              }),
            ),
          );
          const next = inspectLocal(directory);
          if (!next) {
            p.log.warn("No supported running T3 instance at that directory.");
            continue;
          }
          const nextProviders = providers(
            JSON.parse(
              readOptional(join(next.baseDir, "userdata/settings.json")) ??
                "{}",
            ),
          );
          if (!nextProviders.length) {
            p.log.warn("That instance has no enabled Codex configuration.");
            continue;
          }
          await checkT3Support(next);
          server = next;
          available = nextProviders;
          codexHome = undefined;
          providerId =
            available.length === 1
              ? available[0]!.id
              : await answer(
                  p.select({
                    message: "Which Codex configuration?",
                    options: available.map((p) => ({
                      value: p.id,
                      label: p.label,
                    })),
                  }),
                );
        }
        if (choice === "provider") {
          providerId = await answer(
            p.select({
              message: "Codex configuration",
              initialValue: providerId,
              options: available.map((p) => ({ value: p.id, label: p.label })),
            }),
          );
          codexHome = undefined;
        }
        if (choice === "paths") {
          codexHome = await answer(
            p.text({
              message: "Codex configuration directory",
              initialValue: plan.codexHome,
              validate: (v) => (!v?.trim() ? "Enter a directory." : undefined),
            }),
          );
          stateHome = expandPath(
            await answer(
              p.text({
                message: "t3poll state directory",
                initialValue: stateHome,
                validate: (v) =>
                  !v?.trim() ? "Enter a directory." : undefined,
              }),
            ),
          );
        }
      }
    }
    // Verify the exact runtime command before modifying configuration. No watch/list
    // calls: list can restart workers, so setup uses only the MCP tool catalog.
    if (interactive) p.log.step("Checking MCP runtime");
    const codexProcess = liveEnvironment(server);
    await checkCodex(
      plan,
      { ...codexProcess.env, ...plan.provider.environment },
      codexProcess.cwd,
    );
    await verifyRuntime(plan);
    const current = inspectLocal(server.baseDir);
    if (!current || current.origin !== server.origin)
      throw new Error("T3 changed during setup. Run setup again.");
    const latestEnv = liveEnvironment(current);
    const rechecked = planInstall({
      baseDir: server.baseDir,
      providerId,
      stateHome,
      version: pkg.version,
      ...launch,
      processEnv: latestEnv.env,
      processCwd: latestEnv.cwd,
      ...(codexHome ? { codexHome } : {}),
    });
    if (JSON.stringify(rechecked) !== JSON.stringify(plan))
      throw new Error(
        "Configuration changed during setup. Review it again by rerunning setup.",
      );
    const transaction = applyPlan(plan);
    try {
      const credential = await connection({
        home: plan.stateHome,
        baseDir: plan.baseDir,
      });
      await new T3(credential.origin, credential.tokenFile).threads();
    } catch (error) {
      transaction.rollback();
      throw error;
    }
    for (const backup of transaction.backups) console.log(`Backup: ${backup}`);
    const done =
      "Setup complete. Open a fresh Codex session in the selected T3 instance to use t3poll. Existing sessions keep their current tools.";
    if (interactive) p.outro(done);
    else console.log(done);
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Setup cancelled.");
      return;
    }
    throw error;
  }
}
