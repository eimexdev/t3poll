import { z } from "zod";

export const watchInput = z.object({
  pr: z
    .string()
    .describe(
      "GitHub PR URL, for example https://github.com/owner/repo/pull/123.",
    ),
  threadId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Destination T3 thread ID. Use list with threads=true to select it. May be omitted only when T3POLL_THREAD_ID is configured.",
    ),
  intervalSeconds: z
    .number()
    .int()
    .min(15)
    .max(3600)
    .default(60)
    .describe(
      "Seconds between GitHub checks; unchanged checks do not invoke the model.",
    ),
});
export type WatchInput = z.input<typeof watchInput>;

export type Entry = {
  fingerprint: string;
  kind: "review" | "comment" | "check";
  label: string;
  url: string;
};
export type Snapshot = {
  head: string;
  state: "open" | "closed" | "merged";
  entries: Record<string, Entry>;
};
export type Change = { key: string; text: string; url: string };
export type Command = {
  type: "thread.turn.start";
  commandId: string;
  threadId: string;
  message: { messageId: string; role: "user"; text: string; attachments: [] };
  runtimeMode: string;
  interactionMode: string;
  createdAt: string;
};
export type Watch = {
  id: string;
  key: string;
  revision: number;
  pr: string;
  threadId: string;
  threadTitle: string;
  origin: string;
  tokenFile: string;
  intervalSeconds: number;
  status: "watching" | "finishing" | "completed" | "stopped" | "expired";
  createdAt: number;
  expiresAt: number;
  nextPoll: number;
  lastPoll: number | null;
  snapshot: Snapshot | null;
  pending: Change[];
  command: Command | null;
  nextDelivery: number;
  pollFailures: number;
  deliveryFailures: number;
  lastError: string | null;
  deliveryError: string | null;
  lastDelivery: {
    messageId: string;
    acceptedAt: number;
    sequence: number;
  } | null;
};

export function parsePr(value: string): {
  url: string;
  owner: string;
  repo: string;
  number: number;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Use a GitHub PR URL: https://github.com/owner/repo/pull/123.",
    );
  }
  const match =
    /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/.exec(
      url.pathname,
    );
  if (
    url.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username ||
    url.password ||
    !match
  ) {
    throw new Error(
      "Use a github.com PR URL: https://github.com/owner/repo/pull/123.",
    );
  }
  const [, owner, repo, number] = match;
  if (!owner || !repo || !number || !Number.isSafeInteger(Number(number)))
    throw new Error("Invalid PR URL.");
  return {
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    owner,
    repo,
    number: Number(number),
  };
}

export function changesBetween(
  before: Snapshot,
  after: Snapshot,
  pr: string,
): Change[] {
  const changes: Change[] = [];
  if (before.head !== after.head)
    changes.push({
      key: "head",
      text: `Head commit changed to ${after.head.slice(0, 12)}.`,
      url: pr,
    });
  for (const [key, entry] of Object.entries(after.entries)) {
    if (before.entries[key]?.fingerprint !== entry.fingerprint) {
      changes.push({ key, text: entry.label, url: entry.url });
    }
  }
  if (before.state !== after.state)
    changes.push({ key: "state", text: `PR is now ${after.state}.`, url: pr });
  return changes;
}

export function mergeChanges(pending: Change[], incoming: Change[]): Change[] {
  return [
    ...new Map(
      [...pending, ...incoming].map((change) => [change.key, change]),
    ).values(),
  ];
}

export function notification(watch: Watch): string {
  return `[t3poll] New activity on ${watch.pr}\nCheck the PR for updates and continue the task.`;
}

export function backoff(failures: number, baseSeconds = 60): number {
  return Math.min(30 * 60, baseSeconds * 2 ** Math.min(failures - 1, 8)) * 1000;
}
