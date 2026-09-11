import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { watchInput } from "./model.js";
import type { Service } from "./service.js";

export function createMcp(service: Service): McpServer {
  const server = new McpServer({ name: "t3poll", version: "0.1.0" });
  const call = async (operation: () => unknown | Promise<unknown>) => {
    try {
      const result = await operation();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              error instanceof Error
                ? error.message
                : "t3poll operation failed.",
          },
        ],
      };
    }
  };
  server.registerTool(
    "watch",
    {
      description:
        "Watch a GitHub PR for new comments, reviews, CI results, commits, or closure. Starts a background worker and returns after registration, without holding a tool call open. Updates wake the explicitly selected T3 thread. Use list with threads=true if you need to select a thread; never guess from cwd. Does not act on the PR or replay existing feedback. Watches expire after 24 hours.",
      inputSchema: watchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => call(() => service.watch(args)),
  );
  server.registerTool(
    "list",
    {
      description:
        "List t3poll watches, errors, pending deliveries, and worker status. Restarts a missing worker for saved active watches. Set threads=true to list destination T3 thread IDs and titles.",
      inputSchema: { threads: z.boolean().default(false) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => call(() => service.list(args.threads)),
  );
  server.registerTool(
    "stop",
    {
      description:
        "Stop a watch by ID and cancel its unsent notifications. Does not interrupt an agent turn or undo a notification already submitted to T3.",
      inputSchema: { id: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args) => call(() => service.stop(args.id)),
  );
  return server;
}

export async function serveMcp(service: Service): Promise<void> {
  const server = createMcp(service);
  const transport = new StdioServerTransport();
  server.server.onclose = () => service.close();
  await server.connect(transport);
}
