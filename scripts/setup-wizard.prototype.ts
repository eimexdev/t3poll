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
    hint: "change channel or repair setup",
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
    p.cancel("Prototype closed. Nothing was changed.");
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
p.note(
  "This is a flow prototype with sample data.\nNo files, credentials, or running applications are read or changed.\nUse ↑ ↓ and Enter. Ctrl+C exits at any point.",
  "Try the setup",
);
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
  let channel = "latest";
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
              validate: (v) =>
                !v?.trim()
                  ? "Enter a directory to use in this mock."
                  : undefined,
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
  async function chooseChannel() {
    channel = await answer(
      p.select({
        message: "Which release channel?",
        initialValue: channel,
        options: [
          {
            value: "latest",
            label: "Stable",
            hint: "recommended · follows latest",
          },
          {
            value: "nightly",
            label: "Nightly",
            hint: "early changes · may be less reliable",
          },
        ],
      }),
    );
    p.log.info(
      "The runtime follows your channel when it starts. Running watches are not hot-swapped.",
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

  await step("Checking sample prerequisites");
  p.log.success("Node.js and GitHub CLI are available.");
  if (scenario === "missing") {
    p.note(
      "GitHub CLI is not signed in. T3 is not running.\n\nIn a real setup:\n  1. Run gh auth login in another terminal.\n  2. Open T3 and enable its external API.\n\nThis prototype cannot perform or verify those steps.",
      "Before continuing",
    );
    const action = await answer(
      p.select({
        message: "What would you like to do?",
        options: [
          { value: "retry", label: "Simulate fixing these and check again" },
          { value: "exit", label: "Exit setup" },
        ],
      }),
    );
    if (action === "exit") {
      p.outro("Prototype closed. Nothing was changed.");
      break;
    }
    await step("Rechecking sample prerequisites");
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
            hint: "review settings and choose a channel",
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
      p.outro("Prototype closed. Nothing was changed.");
      break;
    }
    if (action === "change") await chooseChannel();
  } else await chooseChannel();

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
            label: "Simulate removing the override",
            hint: "then use T3’s saved settings",
          },
          { value: "exit", label: "Exit setup" },
        ],
      }),
    );
    if (action === "exit") {
      p.outro("Prototype closed. Nothing was changed.");
      break;
    }
    if (action === "instructions") {
      launchMode = "Manual launch environment update required";
      p.note(
        "The finished wizard would show the merged launch arguments here,\nincluding your existing arguments and the t3poll enablement.\nYou would apply them to T3CODE_CODEX_LAUNCH_ARGS and restart T3.\n\nThis prototype has no real launch arguments to merge.",
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
        `Channel:     ${channel === "latest" ? "Stable (latest)" : "Nightly"}`,
        `Config:      ${codexHome}`,
        `State:       ${stateHome}`,
        `Launch:      ${launchMode}`,
        `Credentials: Managed automatically for this T3 instance`,
      ].join("\n"),
      "Review your setup",
    );
    const action = await answer(
      p.select({
        message: "Ready to try it?",
        options: [
          {
            value: "apply",
            label: "Simulate setup",
            hint: "no changes will be made",
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
          "Illustrative plan; runtime installation details are not implemented.",
          "",
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
            { value: "channel", label: "Release channel" },
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
      if (setting === "channel") await chooseChannel();
      if (setting === "advanced") await advanced();
    } else if (action === "exit") {
      p.log.info("Finished without applying. Nothing was changed.");
      finished = true;
    } else {
      for (const message of [
        "Simulating configuration backup",
        "Simulating MCP registration and instance binding",
        "Simulating managed credential creation",
      ])
        await step(message);
      if (launchMode.startsWith("Manual")) {
        p.log.warn(
          "Simulation paused before verification: the launch environment still needs updating.\nThe real wizard would ask you to restart T3, then recheck the connection.",
        );
        await answer(
          p.select({
            message: "Continue the simulation?",
            options: [
              {
                value: "continue",
                label: "Simulate updating launch arguments and restarting T3",
              },
            ],
          }),
        );
      } else await step("Simulating T3 launch argument update");
      await step("Simulating MCP connection check");
      p.note(
        "Simulation complete. Nothing was installed or changed.\n\nAfter a real setup, open a fresh Codex session in the selected T3 instance.\nTry: “Watch this PR and let me know when it needs attention.”\nThe PR and destination thread are chosen when you start a watch.",
        "Ready for a first watch",
      );
      finished = true;
    }
  }
  const again = await answer(
    p.confirm({ message: "Try another scenario?", initialValue: false }),
  );
  if (!again) {
    p.outro("Thanks for trying the setup flow. Nothing was changed.");
    break;
  }
  scenario = await answer(
    p.select({
      message: "Which situation would you like to try?",
      options: [...scenarios],
    }),
  );
}
