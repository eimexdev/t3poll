# Setup wizard prototype

This throwaway terminal prototype lets you try the setup flow before we build discovery, runtime installation, credential management, or config writes.

```sh
npm ci
npm run setup:mock
```

Use the arrow keys and Enter. Ctrl+C closes the wizard. It requires an interactive terminal and the project's supported Node.js version (24.10 or newer).

Choose a sample situation: first setup, multiple T3 instances, an existing setup, missing prerequisites, or a launch argument conflict. To skip that prototype-only menu:

```sh
npm run setup:mock -- --scenario multiple
```

Other scenario names are `fresh`, `existing`, `missing`, and `conflict`.

The flow covers T3 instance selection, a Codex provider configuration, T3-only scope, the release channel inherited from the invoked package, advanced paths, review and editing, proposed changes, and a simulated connection check. The default path uses detected sample settings to keep the number of questions small. Paths adapt to Windows or Unix conventions.

All data is invented and lives in memory. The script does not read your configuration, call GitHub or T3, launch processes, create credentials, install the runtime, or write files. The proposed changes describe intent; they are not a finalized implementation contract. The production CLI is unchanged, and this script is not included in its build.

## What to decide by trying it

- Is the default flow short enough?
- Is the T3-only scope clear?
- Does the review screen make it easy to spot and correct a wrong choice?
- Do the prerequisite and launch override detours explain how to continue?

Implementation: `scripts/setup-wizard.prototype.ts`. Keep this on the prototype branch until the interaction is approved; backend work should follow that decision.

The channel is not a setup question: `npx t3poll@nightly setup` selects Nightly, and `npx t3poll@latest setup` selects Stable. This sample represents the Stable invocation. The terminal copy uses the intended product wording; its actions remain in-memory simulations.
