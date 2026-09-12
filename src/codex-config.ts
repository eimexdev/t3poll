import { isDeepStrictEqual } from "node:util";
import { parse } from "smol-toml";
import { parseTOML, type AST } from "toml-eslint-parser";

// Patch the specific value by syntax ranges, preserving comments and formatting.
// For an implicit default, try the nearest containing table. Parsing the result
// verifies that the insertion changes exactly the intended semantic value.
export function disableGlobalEntry(source: string): string {
  const expected = parse(source);
  const servers = expected.mcp_servers as
    Record<string, Record<string, unknown>> | undefined;
  if (!servers?.t3poll || servers.t3poll.enabled === false) return source;
  servers.t3poll.enabled = false;
  const ast = parseTOML(source);
  const target = ["mcp_servers", "t3poll", "enabled"];
  const candidates: string[] = [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  function visit(
    container: AST.TOMLTopLevelTable | AST.TOMLTable | AST.TOMLInlineTable,
    path: (string | number)[],
  ) {
    if (
      path.length < target.length &&
      path.every((key, i) => key === target[i])
    ) {
      const assignment = `${target.slice(path.length).join(".")} = false`;
      if (container.type === "TOMLInlineTable") {
        const end = container.range[1] - 1;
        const last = container.body.at(-1);
        const trailingComma =
          last &&
          ast.tokens.some(
            (t) =>
              t.range[0] >= last.range[1] &&
              t.range[1] <= end &&
              t.value === ",",
          );
        candidates.push(
          source.slice(0, end) +
            (last && !trailingComma ? ", " : " ") +
            assignment +
            source.slice(end),
        );
      } else {
        const headerEnd =
          container.type === "TOMLTable"
            ? source.indexOf("\n", container.key.range[1])
            : -1;
        const offset =
          container.type === "TOMLTopLevelTable"
            ? 0
            : headerEnd < 0
              ? source.length
              : headerEnd + 1;
        candidates.push(
          source.slice(0, offset) +
            (offset && source[offset - 1] !== "\n" ? newline : "") +
            assignment +
            newline +
            source.slice(offset),
        );
      }
    }
    for (const item of container.body) {
      if (item.type === "TOMLTable") {
        visit(item, item.resolvedKey);
        continue;
      }
      const key = [
        ...path,
        ...item.key.keys.map((k) => (k.type === "TOMLBare" ? k.name : k.value)),
      ];
      if (isDeepStrictEqual(key, target))
        candidates.unshift(
          source.slice(0, item.value.range[0]) +
            "false" +
            source.slice(item.value.range[1]),
        );
      if (item.value.type === "TOMLInlineTable") visit(item.value, key);
    }
  }
  visit(ast.body[0], []);
  for (const candidate of candidates) {
    try {
      if (isDeepStrictEqual(parse(candidate), expected)) return candidate;
    } catch {
      /* Try a more specific table. */
    }
  }
  throw new Error(
    "Could not update the global t3poll entry without changing other settings.",
  );
}

// An inline mcp_servers table is sealed in TOML: a managed sibling section
// cannot be appended. Expand just that assignment into dotted assignments,
// retaining the existing values and comments rather than rewriting the file.
export function expandInlineServers(source: string): string {
  const ast = parseTOML(source);
  for (const item of ast.body[0].body) {
    if (item.type !== "TOMLKeyValue" || item.key.keys.length !== 1) continue;
    const key = item.key.keys[0]!;
    if (
      (key.type === "TOMLBare" ? key.name : key.value) !== "mcp_servers" ||
      item.value.type !== "TOMLInlineTable"
    )
      continue;
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const body = item.value.body;
    const comments = ast.comments.filter(
      (c) =>
        c.range[0] >= item.range[0] &&
        c.range[1] <= item.range[1] &&
        !body.some(
          (kv) =>
            c.range[0] >= kv.value.range[0] && c.range[1] <= kv.value.range[1],
        ),
    );
    const prefix = source.slice(...item.key.range);
    const replacement = [
      ...comments.map((c) => source.slice(...c.range)),
      ...body.map(
        (kv) =>
          `${prefix}.${source.slice(...kv.key.range)} = ${source.slice(...kv.value.range)}`,
      ),
    ].join(newline);
    const result =
      source.slice(0, item.range[0]) +
      replacement +
      source.slice(item.range[1]);
    const expected = parse(source);
    if (!body.length) delete expected.mcp_servers;
    if (!isDeepStrictEqual(parse(result), expected))
      throw new Error(
        "Could not expand MCP configuration without changing existing entries.",
      );
    return result;
  }
  return source;
}

// Broken marker pairs do not define a safe text range. Remove only the named
// server's syntax nodes and actual marker comments, then verify all other data.
export function recoverManagedEntry(source: string, server: string): string {
  const ast = parseTOML(source);
  const markers = new Set([
    `# t3poll managed ${server} begin`,
    `# t3poll managed ${server} end`,
  ]);
  const comments = ast.comments.filter((c) =>
    markers.has(source.slice(...c.range).trim()),
  );
  if (!comments.length) return source;
  const ranges: [number, number][] = comments.map((c) => [...c.range]);
  const owns = (path: (string | number)[]) =>
    path[0] === "mcp_servers" && path[1] === server;
  for (const item of ast.body[0].body) {
    if (item.type === "TOMLTable") {
      if (owns(item.resolvedKey)) {
        const closing = ast.tokens.find(
          (t) => t.range[0] >= item.key.range[1] && t.value === "]",
        );
        if (!closing)
          throw new Error("Could not locate the t3poll table header.");
        ranges.push([item.range[0], closing.range[1]]);
        for (const kv of item.body) ranges.push([...kv.range]);
      } else {
        for (const kv of item.body) {
          const path = [
            ...item.resolvedKey,
            ...kv.key.keys.map((k) =>
              k.type === "TOMLBare" ? k.name : k.value,
            ),
          ];
          if (owns(path)) ranges.push([...kv.range]);
        }
      }
    } else if (
      owns(item.key.keys.map((k) => (k.type === "TOMLBare" ? k.name : k.value)))
    ) {
      ranges.push([...item.range]);
    }
  }
  // Merge overlapping ranges, e.g. marker comments inside a removed value.
  const merged: [number, number][] = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  let result = source;
  for (const [start, end] of merged.reverse())
    result = result.slice(0, start) + result.slice(end);
  const expected = parse(source);
  const servers = expected.mcp_servers as Record<string, unknown> | undefined;
  if (servers) delete servers[server];
  const actual = parse(result);
  // Removing the only server can also remove its implicit parent table.
  for (const config of [expected, actual]) {
    if (config.mcp_servers && Object.keys(config.mcp_servers).length === 0)
      delete config.mcp_servers;
  }
  if (!isDeepStrictEqual(actual, expected))
    throw new Error(
      "Could not recreate the t3poll entry without changing other settings.",
    );
  return result;
}
