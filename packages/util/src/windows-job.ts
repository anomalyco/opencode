import type { Pointer } from "bun:ffi"
import { load } from "#kernel32"

// A Windows job object holds a spawned process and every process it starts, including descendants whose parent has
// already exited, which `taskkill /T` cannot find through parent links. Kill-on-close ties a running command's
// processes to opencode: if opencode exits or crashes, Windows ends them.

const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
// Programs that start a child with CREATE_BREAKAWAY_FROM_JOB keep working; without this, that start fails.
const JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x0800
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

// A pointer is a Pointer number in Bun and a bigint in Node; a null pointer comes back as null (Bun) or 0n (Node).
export type Handle = Pointer | bigint

export interface Kernel32 {
  CreateJobObjectW(attributes: null, name: null): Handle | null
  SetInformationJobObject(job: Handle, infoClass: number, info: Uint8Array, length: number): number
  OpenProcess(access: number, inherit: number, pid: number): Handle | null
  AssignProcessToJobObject(job: Handle, process: Handle): number
  TerminateJobObject(job: Handle, exitCode: number): number
  CloseHandle(handle: Handle): number
}

export type Job = {
  /** Ends every process in the job. */
  readonly kill: () => boolean
  /** Stops owning the job. Processes still in it keep running, also after opencode exits. */
  readonly release: () => void
}

let kernel32: Kernel32 | undefined

/** Puts a just-spawned process in a new job. Undefined off Windows, without FFI, or if Windows refuses. */
export function attach(pid: number): Job | undefined {
  if (process.platform !== "win32") return
  kernel32 ??= load()
  const lib = kernel32
  if (!lib) return
  const job = lib.CreateJobObjectW(null, null)
  if (!job) return
  const child = lib.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid)
  const assigned =
    !!child &&
    limit(lib, job, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK) &&
    lib.AssignProcessToJobObject(job, child) !== 0
  if (child) lib.CloseHandle(child)
  if (!assigned) {
    lib.CloseHandle(job)
    return
  }
  return {
    kill: () => lib.TerminateJobObject(job, 1) !== 0,
    release: () => {
      limit(lib, job, JOB_OBJECT_LIMIT_BREAKAWAY_OK)
      lib.CloseHandle(job)
    },
  }
}

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes on 64-bit Windows, with LimitFlags at byte 16.
function limit(lib: Kernel32, job: Handle, flags: number) {
  const info = new Uint8Array(144)
  new DataView(info.buffer).setUint32(16, flags, true)
  return lib.SetInformationJobObject(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, info, info.length) !== 0
}

export * as WindowsJob from "./windows-job.js"
