import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { parsePr, type Snapshot, type Entry } from "./model.js";

const exec = promisify(execFile);
const id = z.union([z.number(), z.string()]);
const feedback = z.object({
  id,
  body: z.string().nullable().optional(),
  html_url: z.string(),
  state: z.string().optional(),
});
const check = z.object({
  id,
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string().nullable(),
  app: z.object({ id }).nullable().optional(),
});
const status = z.object({
  id,
  context: z.string(),
  state: z.string(),
  target_url: z.string().nullable(),
});
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value: string) =>
  value.replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 120);
const safeUrl = (value: string | null, fallback: string) => {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
};

export type GhApi = (path: string, paginate?: boolean) => Promise<unknown>;
export const ghApi: GhApi = async (path, paginate = false) => {
  try {
    const { stdout } = await exec(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        ...(paginate ? ["--paginate", "--slurp"] : []),
        path,
      ],
      {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: "1" },
      },
    );
    return JSON.parse(stdout) as unknown;
  } catch {
    // gh stderr can contain server-provided data. Keep it out of model-visible errors.
    throw new Error(
      "GitHub read failed. Check gh auth status, repository access, connectivity, and API rate limits. Retrying with backoff.",
    );
  }
};

export async function readGithub(
  pr: string,
  api: GhApi = ghApi,
): Promise<Snapshot> {
  const { owner, repo, number } = parsePr(pr);
  const root = `repos/${owner}/${repo}`;
  const pull = z
    .object({
      state: z.enum(["open", "closed"]),
      merged: z.boolean(),
      head: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) }),
    })
    .parse(await api(`${root}/pulls/${number}`));
  const sha = pull.head.sha;
  const [reviews, comments, conversation, checks, statuses] = await Promise.all(
    [
      api(`${root}/pulls/${number}/reviews?per_page=100`, true),
      api(`${root}/pulls/${number}/comments?per_page=100`, true),
      api(`${root}/issues/${number}/comments?per_page=100`, true),
      api(`${root}/commits/${sha}/check-runs?per_page=100&filter=latest`, true),
      api(`${root}/commits/${sha}/statuses?per_page=100`, true),
    ],
  );
  const entries: Record<string, Entry> = {};
  for (const [kind, raw] of [
    ["review", reviews],
    ["inline", comments],
    ["conversation", conversation],
  ] as const) {
    for (const item of z.array(z.array(feedback)).parse(raw).flat()) {
      if (item.state === "PENDING") continue;
      entries[`${kind}:${item.id}`] = {
        fingerprint: hash([item.body ?? "", item.state]),
        kind: kind === "review" ? "review" : "comment",
        label:
          kind === "review"
            ? `Review ${item.id}: ${clean(item.state ?? "submitted")}.`
            : `Comment ${item.id} was added or updated.`,
        url: safeUrl(item.html_url, pr),
      };
    }
  }
  const runs = z
    .array(z.object({ check_runs: z.array(check) }))
    .parse(checks)
    .flatMap((page) => page.check_runs);
  // GitHub's latest filter can still return several attempts. Pick the newest per app/name.
  for (const item of runs.sort((a, b) => Number(a.id) - Number(b.id))) {
    const key = `check:${item.app?.id ?? "unknown"}:${item.name}`;
    delete entries[key];
    if (item.status !== "completed" || !item.conclusion) continue;
    entries[key] = {
      fingerprint: hash([sha, item.id, item.conclusion]),
      kind: "check",
      label: `Check "${clean(item.name)}": ${clean(item.conclusion)}.`,
      url: safeUrl(item.html_url, pr),
    };
  }
  for (const item of z
    .array(z.array(status))
    .parse(statuses)
    .flat()
    .sort((a, b) => Number(a.id) - Number(b.id))) {
    const key = `status:${item.context}`;
    delete entries[key];
    if (item.state === "pending") continue;
    entries[key] = {
      fingerprint: hash([sha, item.id, item.state]),
      kind: "check",
      label: `Status "${clean(item.context)}": ${clean(item.state)}.`,
      url: safeUrl(item.target_url, pr),
    };
  }
  return { head: sha, state: pull.merged ? "merged" : pull.state, entries };
}
