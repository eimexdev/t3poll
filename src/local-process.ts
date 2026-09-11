import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync, statSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";

type LocalProcess = {
  args: string[];
  env: Record<string, string>;
  cwd: string;
  executable: string;
};

function environment(entries: string[]): Record<string, string> {
  return Object.fromEntries(
    entries
      .filter((s) => s.includes("="))
      .map((s) => {
        const i = s.indexOf("=");
        return [s.slice(0, i), s.slice(i + 1)];
      }),
  );
}

// KERN_PROCARGS2 contains argc, executable, padding, argv, then environ.
// Keep the NUL boundaries: ps command text cannot distinguish spaces in paths.
export function parseProcArgs(
  buffer: Buffer,
): Pick<LocalProcess, "args" | "env"> {
  const argc = buffer.readInt32LE(0);
  if (argc < 1 || argc > buffer.length)
    throw new Error("Invalid process arguments");
  let offset = buffer.indexOf(0, 4);
  if (offset < 0) throw new Error("Invalid process executable");
  while (buffer[offset] === 0) offset++;
  const args: string[] = [];
  for (let i = 0; i < argc; i++) {
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new Error("Truncated process arguments");
    args.push(buffer.toString("utf8", offset, end));
    offset = end + 1;
  }
  return {
    args,
    env: environment(buffer.toString("utf8", offset).split("\0")),
  };
}

function lsof(pid: number, descriptors?: string): string[] {
  return execFileSync(
    "/usr/sbin/lsof",
    [
      "-a",
      "-p",
      String(pid),
      ...(descriptors ? ["-d", descriptors] : []),
      "-F0n",
    ],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  )
    .split("\0")
    .map((s) => s.replace(/^\n/, ""))
    .filter((s) => s.startsWith("n"))
    .map((s) => s.slice(1));
}

export function hasOpenFile(pid: number, path: string): boolean {
  const expected = realpathSync(path);
  return lsof(pid).some((file) => {
    try {
      return realpathSync(file) === expected;
    } catch {
      return false;
    }
  });
}

let darwin:
  | ((pid: number) => Pick<LocalProcess, "args" | "env" | "executable">)
  | undefined;
function readDarwin(pid: number) {
  if (!darwin) {
    // Loaded only on macOS; Linux retains its /proc implementation.
    const koffi = createRequire(import.meta.url)(
      "koffi",
    ) as typeof import("koffi");
    const lib = koffi.load("/usr/lib/libSystem.B.dylib");
    const sysctl = lib.func(
      "int sysctl(int *name, unsigned int namelen, void *oldp, _Inout_ size_t *oldlenp, void *newp, size_t newlen)",
    );
    const pidpath = lib.func(
      "int proc_pidpath(int pid, void *buffer, unsigned int buffersize)",
    );
    darwin = (processId) => {
      const buffer = Buffer.alloc(1024 * 1024);
      const size = [buffer.length];
      if (sysctl([1, 49, processId], 3, buffer, size, null, 0) !== 0)
        throw new Error("Cannot inspect process arguments");
      const executable = Buffer.alloc(4096);
      if (pidpath(processId, executable, executable.length) <= 0)
        throw new Error("Cannot inspect process executable");
      return {
        ...parseProcArgs(buffer.subarray(0, Number(size[0]))),
        executable: executable.toString("utf8", 0, executable.indexOf(0)),
      };
    };
  }
  return darwin(pid);
}

export function readLocalProcess(pid: number): LocalProcess {
  if (process.platform === "linux") {
    const proc = `/proc/${pid}`;
    if (statSync(proc).uid !== process.getuid?.())
      throw new Error("Different process owner");
    return {
      args: readFileSync(`${proc}/cmdline`, "utf8").split("\0"),
      env: environment(readFileSync(`${proc}/environ`, "utf8").split("\0")),
      cwd: readlinkSync(`${proc}/cwd`),
      executable: readlinkSync(`${proc}/exe`),
    };
  }
  if (process.platform !== "darwin") throw new Error("Unsupported platform");
  const uid = execFileSync("/bin/ps", ["-p", String(pid), "-o", "uid="], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
  if (!uid || Number(uid) !== process.getuid?.())
    throw new Error("Different process owner");
  const details = readDarwin(pid);
  const cwd = lsof(pid, "cwd")[0];
  if (!cwd) throw new Error("Cannot inspect process directory");
  return { ...details, cwd };
}
