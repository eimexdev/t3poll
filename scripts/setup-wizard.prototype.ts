/** Throwaway interaction prototype. No discovery, persistence, or subprocesses. */
import * as p from "@clack/prompts";
import { setTimeout as delay } from "node:timers/promises";

const scenarios = [
  {
    value: "fresh",
    label: "First setup",
    hint: "one T3 instance, ready to go",
  },
  {
    value: "multiple",
    label: "Multiple instances",
    hint: "choose T3 and a Codex configuration",
  },
  {
    value: "existing",
    label: "Already configured",
    hint: "review or repair setup",
  },
  {
    value: "missing",
    label: "Missing prerequisites",
    hint: "GitHub sign-in and T3 startup",
  },
  {
    value: "conflict",
    label: "Launch argument conflict",
    hint: "an environment override is present",
  },
] as const;
type Scenario = (typeof scenarios)[number]["value"];
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Usage: npm run setup:mock -- [--scenario fresh|multiple|existing|missing|conflict]\n\nInteractive prototype using sample data. No configuration is read or written.",
  );
  process.exit(0);
}
const requested =
  args[0] === "--scenario" && args.length === 2 ? args[1] : undefined;
if (args.length && !scenarios.some((s) => s.value === requested)) {
  console.error("Unknown arguments. Run npm run setup:mock -- --help");
  process.exit(1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Open an interactive terminal and run: npm run setup:mock");
  process.exit(1);
}

async function answer<T>(prompt: Promise<T | symbol>): Promise<T> {
  const value = await prompt;
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value as T;
}
async function step(message: string) {
  const spinner = p.spinner();
  spinner.start(message);
  await delay(250);
  spinner.stop(message);
}
const windows = process.platform === "win32";
const home = windows ? "C:\\Users\\Alex" : "/home/alex";
const path = (...parts: string[]) =>
  [home, ...parts].join(windows ? "\\" : "/");
const instances = [
  {
    value: "desktop",
    label: "T3 Desktop",
    hint: path(".t3"),
    directory: path(".t3"),
  },
  {
    value: "dev",
    label: "T3 development",
    hint: path(".t3-dev"),
    directory: path(".t3-dev"),
  },
  {
    value: "custom",
    label: "Enter a T3 data directory",
    hint: "another local instance",
    directory: "",
  },
];

p.intro("t3poll / setup");
let scenario: Scenario =
  (requested as Scenario) ??
  (await answer(
    p.select({
      message: "Which situation would you like to try?",
      options: [...scenarios],
    }),
  ));

while (true) {
  let instance = "desktop";
  let directory = path(".t3");
  let provider = "default";
  // Sample invocation: npx t3poll@latest setup. The packaged CLI will use its build channel.
  const channel = "latest";
  let codexHome = path(".codex");
  let stateHome = path(".local", "share", "t3poll");
  if (windows) stateHome = path("AppData", "Local", "t3poll");
  let codexExecutable = "codex";
  let launchMode = "Update the selected T3 instance’s saved launch arguments";

  async function chooseInstance() {
    instance = await answer(
      p.select({
        message: "Which T3 instance should use t3poll?",
        initialValue: instance,
        options: instances,
      }),
    );
    directory =
      instance === "custom"
        ? await answer(
            p.text({
              message: "T3 data directory",
              placeholder: path(".t3-work"),
              validate: (v) => (!v?.trim() ? "Enter a directory." : undefined),
            }),
          )
        : instances.find((i) => i.value === instance)!.directory;
  }
  async function chooseProvider() {
    provider = await answer(
      p.select({
        message: "Which Codex configuration in this T3 instance?",
        initialValue: provider,
        options: [
          { value: "default", label: "Codex — default", hint: "codex" },
          {
            value: "work",
            label: "Codex — work",
            hint: "a separate provider configuration",
          },
        ],
      }),
    );
  }
  async function advanced() {
    codexHome = await answer(
      p.text({
        message: "Codex configuration directory",
        initialValue: codexHome,
        validate: (v) => (!v?.trim() ? "Enter a directory." : undefined),
      }),
    );
    stateHome = await answer(
      p.text({
        message: "t3poll state directory",
        initialValue: stateHome,
        validate: (v) => (!v?.trim() ? "Enter a directory." : undefined),
      }),
    );
    codexExecutable = await answer(
      p.text({
        message: "Codex executable",
        initialValue: codexExecutable,
        validate: (v) =>
          !v?.trim() ? "Enter an executable name or path." : undefined,
      }),
    );
  }

  await step("Checking prerequisites");
  p.log.success("Node.js and GitHub CLI are available.");
  if (scenario === "missing") {
    p.note(
      "GitHub CLI is not signed in. T3 is not running.\n\n  1. Run gh auth login in another terminal.\n  2. Open T3.\n\nThen check again to continue.",
      "Before continuing",
    );
    const action = await answer(
      p.select({
        message: "What would you like to do?",
        options: [
          { value: "retry", label: "Check again" },
          { value: "exit", label: "Exit setup" },
        ],
      }),
    );
    if (action === "exit") {
      p.outro("Setup cancelled.");
      break;
    }
    await step("Rechecking prerequisites");
  }
  p.log.success(
    "GitHub signed in as alex-example. T3 external API is available.",
  );
  if (scenario === "multiple") {
    await chooseInstance();
    await chooseProvider();
  } else p.log.info(`Found T3 Desktop · ${directory}\nCodex — default`);
  p.log.info(
    "T3-only scope: tools will be enabled for the selected Codex configuration in this T3 instance.\nStandalone Codex sessions keep t3poll disabled. Codex is the only supported client in this first version.",
  );

  if (scenario === "existing") {
    const action = await answer(
      p.select({
        message: "t3poll is already set up on Stable. What next?",
        options: [
          {
            value: "change",
            label: "Change setup",
            hint: "review settings",
          },
          {
            value: "repair",
            label: "Repair setup",
            hint: "reapply settings and check connection",
          },
          { value: "exit", label: "Leave as is" },
        ],
      }),
    );
    if (action === "exit") {
      p.outro("Setup cancelled.");
      break;
    }
  }

  if (scenario === "conflict") {
    p.note(
      "T3CODE_CODEX_LAUNCH_ARGS overrides T3’s saved launch arguments.\nChanging the saved setting alone would have no effect.\nYour existing arguments would be preserved.",
      "Launch override detected",
    );
    const action = await answer(
      p.select({
        message: "How would you like to handle the override?",
        options: [
          {
            value: "instructions",
            label: "Show launch instructions",
            hint: "update the environment where you start T3",
          },
          {
            value: "retry",
            label: "I removed the override — check again",
            hint: "then use T3’s saved settings",
          },
          { value: "exit", label: "Exit setup" },
        ],
      }),
    );
    if (action === "exit") {
      p.outro("Setup cancelled.");
      break;
    }
    if (action === "instructions") {
      launchMode = "Manual launch environment update required";
      p.note(
        "Add -c mcp_servers.t3poll.enabled=true to your existing\nT3CODE_CODEX_LAUNCH_ARGS, then restart T3.",
        "Manual step",
      );
    }
  }

  let finished = false;
  while (!finished) {
    p.note(
      [
        `T3:          ${directory}`,
        `Codex:       ${provider} (${codexExecutable})`,
        `Scope:       Selected T3 instance only`,
        `Channel:     ${channel} (from invoked package)`,
        `Config:      ${codexHome}`,
        `State:       ${stateHome}`,
        `Launch:      ${launchMode}`,
        `Credentials: Managed automatically for this T3 instance`,
      ].join("\n"),
      "Review your setup",
    );
    const action = await answer(
      p.select({
        message: "Ready to set up t3poll?",
        options: [
          {
            value: "apply",
            label: "Set up t3poll",
          },
          { value: "edit", label: "Edit choices" },
          { value: "preview", label: "View proposed changes" },
          { value: "exit", label: "Finish without applying" },
        ],
      }),
    );
    if (action === "preview") {
      p.note(
        [
          `1. Back up the affected configuration in ${codexHome}.`,
          `2. Register the MCP runtime on the ${channel} channel, disabled by default.`,
          `3. Bind its connection and state to ${directory}.`,
          `4. ${launchMode}.`,
          "   Enable t3poll only in this T3 Codex configuration.",
          "   Preserve unrelated launch arguments and MCP entries.",
          "5. Create a managed credential and check MCP connectivity.",
          "",
          "No GitHub token entry is needed; the runtime uses GitHub CLI authentication.",
        ].join("\n"),
        "What setup would do",
      );
    } else if (action === "edit") {
      const setting = await answer(
        p.select({
          message: "What would you like to change?",
          options: [
            { value: "instance", label: "T3 instance" },
            { value: "provider", label: "Codex configuration" },
            {
              value: "advanced",
              label: "Advanced paths",
              hint: "Codex config, state, executable",
            },
            { value: "back", label: "Back to review" },
          ],
        }),
      );
      if (setting === "instance") {
        await chooseInstance();
        provider = "default";
      }
      if (setting === "provider") await chooseProvider();
      if (setting === "advanced") await advanced();
    } else if (action === "exit") {
      p.log.info("Finished without applying. Nothing was changed.");
      finished = true;
    } else {
      for (const message of [
        "Backing up configuration",
        "Registering MCP for this instance",
        "Creating managed credential",
      ])
        await step(message);
      if (launchMode.startsWith("Manual")) {
        p.log.warn(
          "Update the launch environment and restart T3 before checking the connection.",
        );
        await answer(
          p.select({
            message: "Ready to check the connection?",
            options: [
              {
                value: "continue",
                label: "I updated the launch arguments and restarted T3",
              },
            ],
          }),
        );
      } else await step("Updating T3 launch arguments");
      await step("Checking MCP connection");
      p.note(
        "Open a fresh Codex session in the selected T3 instance.\nTry: “Watch this PR and let me know when it needs attention.”\nThe PR and destination thread are chosen when you start a watch.",
        "Ready for a first watch",
      );
      finished = true;
    }
  }
  const again = await answer(
    p.confirm({ message: "Try another scenario?", initialValue: false }),
  );
  if (!again) {
    p.outro("Done.");
    break;
  }
  scenario = await answer(
    p.select({
      message: "Which situation would you like to try?",
      options: [...scenarios],
    }),
  );
}
