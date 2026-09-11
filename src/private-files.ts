import { chmodSync, mkdirSync, statSync, realpathSync } from "node:fs";
import { windows } from "./windows.js";

export function protectFile(path: string): void {
  if (process.platform === "win32") windows().protect(path);
  else chmodSync(path, 0o600);
}

export function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") windows().protect(path);
}

export function assertPrivateFile(path: string): void {
  if (process.platform === "win32") windows().assertPrivate(realpathSync(path));
  else if ((statSync(path).mode & 0o077) !== 0)
    throw new Error("File permissions must be 600");
}
