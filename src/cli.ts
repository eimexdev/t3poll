#!/usr/bin/env node
import { parseArgs } from "node:util";
import { configFromEnv } from "./config.js";
import { Service } from "./service.js";
import { runWorker } from "./worker.js";

const help = `t3poll — watch a GitHub PR and wake a T3 thread

  t3poll mcp                         Start the stdio MCP server
  t3poll watch <PR URL> --thread <id>  Watch for new activity
  t3poll list [--threads]             Show watches; optionally list T3 threads
  t3poll stop <watch-id>              Stop a watch

Options: --interval <seconds> (15–3600, default 60)
Local T3 connection and credentials are set up automatically.
Overrides: T3POLL_BASE_DIR, T3POLL_URL, T3POLL_TOKEN_FILE, T3POLL_THREAD_ID
State: T3POLL_HOME (default ~/.local/share/t3poll)

watch automatically starts a background worker. No skill or service setup required.
Watches stop on merge/closure, cancellation, or after 24 hours.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      thread: { type: "string" },
      interval: { type: "string" },
      threads: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, argument] = positionals;
  if (!command || values.help) {
    process.stdout.write(help);
    return;
  }
  const config = configFromEnv();
  if (command === "_worker") {
    await runWorker(config.home);
    return;
  }
  if (!["mcp", "watch", "list", "stop"].includes(command))
    throw new Error(`Unknown command ${command}. Run t3poll --help.`);
  const service = new Service(config);
  if (command === "mcp") {
    const { serveMcp } = await import("./mcp.js");
    await serveMcp(service);
    return;
  }
  try {
    let result: unknown;
    if (command === "watch") {
      if (!argument)
        throw new Error("Usage: t3poll watch <PR URL> --thread <id>");
      result = await service.watch({
        pr: argument,
        threadId: values.thread,
        intervalSeconds:
          values.interval === undefined ? undefined : Number(values.interval),
      });
    } else if (command === "list") {
      result = await service.list(values.threads);
    } else {
      if (!argument) throw new Error("Usage: t3poll stop <watch-id>");
      result = service.stop(argument);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    service.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `t3poll: ${error instanceof Error ? error.message : "Operation failed."}\n`,
  );
  process.exitCode = 1;
});
