import { chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
export function makePublic(path: string) {
  if (process.platform === "win32") {
    execFileSync(
      join(process.env.SystemRoot!, "System32", "icacls.exe"),
      [path, "/grant", "*S-1-5-32-545:(R)"],
      { windowsHide: true },
    );
  } else chmodSync(path, 0o644);
}
