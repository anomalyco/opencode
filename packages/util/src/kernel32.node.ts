import type { Kernel32 } from "./windows-job.js"

type Ffi = {
  dlopen(
    path: string,
    definitions: Record<keyof Kernel32, { arguments: string[]; return: string }>,
  ): { functions: Kernel32 }
}

// node:ffi exists only with --experimental-ffi, which the Node build passes.
export function load(): Kernel32 | undefined {
  const ffi = process.getBuiltinModule("node:ffi") as Ffi | undefined
  return ffi?.dlopen("kernel32.dll", {
    CreateJobObjectW: { arguments: ["pointer", "pointer"], return: "pointer" },
    SetInformationJobObject: { arguments: ["pointer", "i32", "pointer", "u32"], return: "i32" },
    OpenProcess: { arguments: ["u32", "i32", "u32"], return: "pointer" },
    AssignProcessToJobObject: { arguments: ["pointer", "pointer"], return: "i32" },
    TerminateJobObject: { arguments: ["pointer", "u32"], return: "i32" },
    CloseHandle: { arguments: ["pointer"], return: "i32" },
  }).functions
}
