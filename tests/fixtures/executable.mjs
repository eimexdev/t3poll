// A real executable fixture: Unix shell launcher or Windows .NET console launcher.
// Production gh execution stays shell-free on both platforms.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export function executable(directory, name, code) {
  const script = join(directory, `${name}.cjs`);
  writeFileSync(script, code);
  if (process.platform !== "win32") {
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    const path = join(directory, name);
    writeFileSync(
      path,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
      { mode: 0o700 },
    );
    return path;
  }
  const path = join(directory, `${name}.exe`);
  const source = join(directory, `${name}.cs`);
  const literal = (value) => '@"' + value.replaceAll('"', '""') + '"';
  writeFileSync(
    source,
    `using System; using System.Diagnostics; using System.Text; using System.Runtime.InteropServices;
class Launcher {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint size);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Quote(string s) {
    var b = new StringBuilder("\\\""); int slashes = 0;
    foreach (char c in s) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') { b.Append('\\\\', slashes * 2 + 1); b.Append(c); }
      else { b.Append('\\\\', slashes); b.Append(c); }
      slashes = 0;
    }
    b.Append('\\\\', slashes * 2); b.Append('"'); return b.ToString();
  }
  static int Main(string[] args) {
    var a = new StringBuilder(Quote(${literal(script)}));
    foreach (var arg in args) { a.Append(' '); a.Append(Quote(arg)); }
    // Killing the fixture launcher must also stop its Node child on Windows.
    var job = CreateJobObject(IntPtr.Zero, null);
    var limits = Marshal.AllocHGlobal(144);
    for (int i = 0; i < 144; i++) Marshal.WriteByte(limits, i, 0);
    Marshal.WriteInt32(limits, 16, 0x2000);
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, limits, 144)) throw new Exception("Cannot create fixture job");
    Marshal.FreeHGlobal(limits);
    var p = Process.Start(new ProcessStartInfo(${literal(process.execPath)}, a.ToString()) { UseShellExecute = false });
    if (!AssignProcessToJobObject(job, p.Handle)) { p.Kill(); throw new Exception("Cannot contain fixture process"); }
    p.WaitForExit(); var result = p.ExitCode; CloseHandle(job); return result;
  }
}`,
  );
  execFileSync(
    join(
      process.env.SystemRoot,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    ),
    ["/nologo", "/target:exe", "/platform:x64", `/out:${path}`, source],
    { windowsHide: true },
  );
  return path;
}
