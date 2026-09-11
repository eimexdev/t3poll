// Native Windows helpers. Loaded lazily so Unix installs never load Windows DLLs.
import { createRequire } from "node:module";
import { join } from "node:path";
import type { LocalProcess } from "./local-process.js";

function load() {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("Windows automatic setup requires x64 Node.js");
  const k = createRequire(import.meta.url)("koffi") as typeof import("koffi");
  const dll = (name: string) =>
    k.load(join(process.env.SystemRoot ?? "C:\\Windows", "System32", name));
  const kernel = dll("kernel32.dll");
  const advapi = dll("advapi32.dll");
  const nt = dll("ntdll.dll");
  const shell = dll("shell32.dll");
  const close = kernel.func("int __stdcall CloseHandle(void *handle)");
  const free = kernel.func("void * __stdcall LocalFree(void *memory)");
  const current = kernel.func("void * __stdcall GetCurrentProcess()");
  const open = kernel.func(
    "void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)",
  );
  const read = kernel.func(
    "int __stdcall ReadProcessMemory(void *process, uintptr_t address, void *buffer, size_t size, _Out_ size_t *read)",
  );
  const query = nt.func(
    "int32_t __stdcall NtQueryInformationProcess(void *process, uint32_t kind, void *buffer, uint32_t size, _Out_ uint32_t *returned)",
  );
  const image = kernel.func(
    "int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, void *buffer, _Inout_ uint32_t *size)",
  );
  const wow64 = kernel.func(
    "int __stdcall IsWow64Process(void *process, _Out_ int *result)",
  );
  const argv = shell.func(
    "void * __stdcall CommandLineToArgvW(str16 command, _Out_ int *argc)",
  );
  const openToken = advapi.func(
    "int __stdcall OpenProcessToken(void *process, uint32_t access, _Out_ void **token)",
  );
  const tokenInfo = advapi.func(
    "int __stdcall GetTokenInformation(void *token, uint32_t kind, void *buffer, uint32_t size, _Out_ uint32_t *needed)",
  );
  const sidString = advapi.func(
    "int __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **text)",
  );
  const getSecurity = advapi.func(
    "uint32_t __stdcall GetNamedSecurityInfoW(str16 path, uint32_t type, uint32_t information, _Out_ void **owner, void *group, _Out_ void **dacl, void *sacl, _Out_ void **descriptor)",
  );
  const getAce = advapi.func(
    "int __stdcall GetAce(void *acl, uint32_t index, _Out_ void **ace)",
  );
  const convert = advapi.func(
    "int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 text, uint32_t revision, _Out_ void **descriptor, void *size)",
  );
  const getDacl = advapi.func(
    "int __stdcall GetSecurityDescriptorDacl(void *descriptor, _Out_ int *present, _Out_ void **acl, _Out_ int *defaulted)",
  );
  const setSecurity = advapi.func(
    "uint32_t __stdcall SetNamedSecurityInfoW(str16 path, uint32_t type, uint32_t information, void *owner, void *group, void *dacl, void *sacl)",
  );
  function sid(pointer: unknown): string {
    const out = [null];
    if (!sidString(pointer, out)) throw new Error("Cannot read Windows owner");
    try {
      return k.decode.string16(out[0]);
    } finally {
      free(out[0]);
    }
  }
  function owner(handle: unknown): string {
    const token = [null];
    if (!openToken(handle, 8, token))
      throw new Error("Cannot inspect process owner");
    try {
      const needed = [0];
      tokenInfo(token[0], 1, null, 0, needed);
      if (!needed[0] || needed[0] > 65536)
        throw new Error("Invalid token information");
      const buffer = Buffer.alloc(needed[0]);
      if (!tokenInfo(token[0], 1, buffer, buffer.length, needed))
        throw new Error("Cannot inspect process owner");
      return sid(k.decode(buffer, "void *"));
    } finally {
      close(token[0]);
    }
  }
  const user = owner(current());
  function inspect(pid: number): LocalProcess {
    // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ. Never request write access.
    const handle = open(0x410, 0, pid);
    if (!handle) throw new Error("Cannot open local process");
    try {
      if (owner(handle) !== user) throw new Error("Different process owner");
      const wow = [0];
      if (!wow64(handle, wow) || wow[0])
        throw new Error("Unsupported process architecture");
      function memory(address: bigint, size: number): Buffer {
        if (!address || size < 0 || size > 1024 * 1024)
          throw new Error("Invalid process memory range");
        const buffer = Buffer.alloc(size);
        const count = [0];
        if (
          !read(handle, address, buffer, size, count) ||
          Number(count[0]) !== size
        )
          throw new Error("Cannot inspect process parameters");
        return buffer;
      }
      const basic = Buffer.alloc(48);
      if (query(handle, 0, basic, basic.length, null) !== 0)
        throw new Error("Cannot inspect process");
      // x64 PEB.ProcessParameters and RTL_USER_PROCESS_PARAMETERS layout.
      // These NT layouts are version-sensitive: malformed/unreadable data fails closed.
      const peb = memory(basic.readBigUInt64LE(8), 40);
      const parameters = memory(peb.readBigUInt64LE(32), 0x88);
      function unicode(offset: number): string {
        const length = parameters.readUInt16LE(offset);
        if (length % 2 || length > parameters.readUInt16LE(offset + 2))
          throw new Error("Invalid process string");
        return length
          ? memory(parameters.readBigUInt64LE(offset + 8), length).toString(
              "utf16le",
            )
          : "";
      }
      const command = unicode(0x70);
      if (!command) throw new Error("Empty process command line");
      const argc = [0];
      const pointers = argv(command, argc);
      if (!pointers || !argc[0] || argc[0] > 32768)
        throw new Error("Invalid process command line");
      let args: string[];
      try {
        args = k.decode(pointers, k.array("str16", argc[0])) as string[];
      } finally {
        free(pointers);
      }
      // Read page-bounded chunks until the UTF-16 environment's double NUL.
      let address = parameters.readBigUInt64LE(0x80);
      const chunks: Buffer[] = [];
      let bytes = 0;
      let environment = "";
      while (bytes < 1024 * 1024) {
        const length = Math.min(
          4096 - Number(address % 4096n),
          1024 * 1024 - bytes,
        );
        const chunk = memory(address, length);
        chunks.push(chunk);
        bytes += length;
        address += BigInt(length);
        environment = Buffer.concat(chunks).toString("utf16le");
        const end = environment.indexOf("\0\0");
        if (end >= 0) {
          environment = environment.slice(0, end);
          break;
        }
      }
      if (bytes >= 1024 * 1024)
        throw new Error("Process environment too large");
      const env: Record<string, string> = {};
      for (const entry of environment.split("\0")) {
        const index = entry.indexOf("=");
        if (index > 0)
          env[entry.slice(0, index).toUpperCase()] = entry.slice(index + 1);
      }
      const buffer = Buffer.alloc(65536);
      const size = [32768];
      if (!image(handle, 0, buffer, size))
        throw new Error("Cannot inspect process executable");
      return {
        args,
        env,
        cwd: unicode(0x38),
        executable: buffer.toString("utf16le", 0, size[0]! * 2),
      };
    } finally {
      close(handle);
    }
  }
  function protect(path: string) {
    const descriptor = [null];
    if (!convert(`D:P(A;OICI;FA;;;${user})`, 1, descriptor, null))
      throw new Error("Cannot build private Windows ACL");
    try {
      const acl = [null];
      if (
        !getDacl(descriptor[0], [0], acl, [0]) ||
        setSecurity(path, 1, 0x80000004, null, null, acl[0], null) !== 0
      )
        throw new Error("Cannot protect Windows credential path");
    } finally {
      free(descriptor[0]);
    }
  }
  function assertPrivate(path: string) {
    const descriptor = [null],
      fileOwner = [null],
      acl = [null];
    if (getSecurity(path, 1, 5, fileOwner, null, acl, null, descriptor) !== 0)
      throw new Error("Cannot read Windows file ACL");
    try {
      if (
        ![user, "S-1-5-18", "S-1-5-32-544"].includes(sid(fileOwner[0])) ||
        !acl[0]
      )
        throw new Error(
          "Credential must have a trusted owner and a private ACL",
        );
      const header = Buffer.from(k.view(acl[0], 8));
      for (let i = 0; i < header.readUInt16LE(4); i++) {
        const ace = [null];
        if (!getAce(acl[0], i, ace))
          throw new Error("Cannot inspect Windows ACL");
        const head = Buffer.from(k.view(ace[0], 8));
        if (head[1]! & 8) continue; // INHERIT_ONLY does not grant access to this file.
        if (head[0] === 1) continue; // Deny entries cannot disclose credentials.
        if (head[0] !== 0 || head.readUInt16LE(2) < 16)
          throw new Error("Unsupported credential ACL");
        const principal = sid(k.address(ace[0]) + 8n);
        if (![user, "S-1-5-18", "S-1-5-32-544"].includes(principal))
          throw new Error("Credential ACL grants access to another user");
      }
    } finally {
      free(descriptor[0]);
    }
  }
  function hasOpenFile(pid: number, path: string): boolean {
    const rm = dll("rstrtmgr.dll");
    const start = rm.func(
      "uint32_t __stdcall RmStartSession(_Out_ uint32_t *session, uint32_t flags, void *key)",
    );
    const register = rm.func(
      "uint32_t __stdcall RmRegisterResources(uint32_t session, uint32_t files, str16 *names, uint32_t apps, void *processes, uint32_t services, void *serviceNames)",
    );
    const list = rm.func(
      "uint32_t __stdcall RmGetList(uint32_t session, _Out_ uint32_t *needed, _Inout_ uint32_t *count, void *processes, _Out_ uint32_t *reasons)",
    );
    const end = rm.func("uint32_t __stdcall RmEndSession(uint32_t session)");
    const session = [0];
    if (start(session, 0, Buffer.alloc(66)) !== 0)
      throw new Error("Cannot inspect open Windows files");
    try {
      if (register(session[0], 1, [path], 0, null, 0, null) !== 0) return false;
      const needed = [0],
        count = [0],
        reasons = [0];
      const result = list(session[0], needed, count, null, reasons);
      if (result === 0) return false;
      if (result !== 234 || !needed[0] || needed[0] > 4096) return false;
      count[0] = needed[0];
      // RM_PROCESS_INFO: DWORD pid, FILETIME start, WCHAR names[256+64], four DWORDs.
      const buffer = Buffer.alloc(count[0] * 668);
      if (list(session[0], needed, count, buffer, reasons) !== 0) return false;
      for (let i = 0; i < count[0]!; i++)
        if (buffer.readUInt32LE(i * 668) === pid) return true;
      return false;
    } finally {
      end(session[0]);
    }
  }
  return { inspect, protect, assertPrivate, hasOpenFile };
}
let api: ReturnType<typeof load> | undefined;
export const windows = () => (api ??= load());
