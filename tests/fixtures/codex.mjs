#!/usr/bin/env node
// Scripted provider for the isolated stock-T3 proof. No account or model calls.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.153.2");
  process.exit(0);
}
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let thread = {
  id: randomUUID(),
  cliVersion: "0.153.2",
  createdAt: Math.floor(Date.now() / 1000),
  updatedAt: Math.floor(Date.now() / 1000),
  cwd: process.cwd(),
  ephemeral: false,
  modelProvider: "openai",
  preview: "",
  source: "appServer",
  status: { type: "idle" },
  turns: [],
};
thread.sessionId = thread.id;
let activeTurns = 0;
const model = {
  id: "gpt-5.3-codex",
  model: "gpt-5.3-codex",
  displayName: "Test provider",
  description: "No model calls",
  isDefault: true,
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: "medium", description: "Test" },
  ],
  defaultReasoningEffort: "medium",
  inputModalities: ["text"],
  supportsPersonality: false,
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  switch (request.method) {
    case "initialize":
      result = {
        userAgent: "t3poll-test",
        platformFamily: "unix",
        platformOs: "linux",
        codexHome: process.env.CODEX_HOME,
      };
      break;
    case "account/read":
      result = {
        account: {
          type: "chatgpt",
          email: "test@example.invalid",
          planType: "pro",
        },
        requiresOpenaiAuth: false,
      };
      break;
    case "account/rateLimits/read":
      result = {
        rateLimits: {
          primary: null,
          secondary: null,
          credits: null,
          planType: "pro",
        },
      };
      break;
    case "model/list":
      result = { data: [model], nextCursor: null };
      break;
    case "config/read":
      result = { config: {}, origins: {}, layers: [] };
      break;
    case "skills/list":
      result = { data: [], errors: [] };
      break;
    case "mcpServerStatus/list":
      result = { data: [], nextCursor: null };
      break;
    case "thread/start":
    case "thread/resume":
      thread = {
        ...thread,
        id: request.params.threadId ?? thread.id,
        cwd: request.params.cwd ?? process.cwd(),
      };
      result = {
        thread,
        cwd: thread.cwd,
        model: "gpt-5.3-codex",
        modelProvider: "openai",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: { type: "readOnly" },
        reasoningEffort: "medium",
      };
      break;
    case "thread/read":
      result = { thread };
      break;
    case "turn/start": {
      const turn = {
        id: randomUUID(),
        items: [],
        status: "inProgress",
        error: null,
      };
      if (process.env.T3POLL_TEST_PROVIDER_LOG)
        appendFileSync(
          process.env.T3POLL_TEST_PROVIDER_LOG,
          `${JSON.stringify({ ...request.params, testWasRunning: activeTurns > 0 })}\n`,
        );
      activeTurns++;
      send({ id: request.id, result: { turn } });
      send({ method: "turn/started", params: { threadId: thread.id, turn } });
      setTimeout(
        () => {
          const item = {
            type: "agentMessage",
            id: randomUUID(),
            text: "Simulated provider received the update.",
          };
          send({
            method: "item/started",
            params: { threadId: thread.id, turnId: turn.id, item },
          });
          send({
            method: "item/completed",
            params: { threadId: thread.id, turnId: turn.id, item },
          });
          activeTurns--;
          const completed = { ...turn, status: "completed", items: [item] };
          thread.turns.push(completed);
          send({
            method: "turn/completed",
            params: { threadId: thread.id, turn: completed },
          });
        },
        Number(process.env.T3POLL_TEST_TURN_DELAY_MS ?? 50),
      );
      return;
    }
  }
  send({ id: request.id, result });
});
