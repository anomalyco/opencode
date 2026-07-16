// aube_wait blocks its calling thread until the operation completes, so every
// operation runs in a worker while the main thread keeps its event loop free.
// The operation handle is posted back before waiting so the main thread can
// aube_cancel it.
import { CString, dlopen, ptr } from "bun:ffi"

import { resolveLibraryPath } from "./library"
import type { FfiOperation, FfiResult, WorkerRequest, WorkerResponse } from "./protocol"

const library = dlopen(await resolveLibraryPath(), {
  aube_init: { args: ["ptr"], returns: "i32" },
  aube_install: { args: ["ptr", "ptr", "ptr"], returns: "u64" },
  aube_add: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "u64" },
  aube_wait: { args: ["u64"], returns: "ptr" },
  aube_string_free: { args: ["ptr"], returns: "void" },
})

const cstr = (value: string) => Buffer.from(`${value}\0`, "utf8")

const start = (op: FfiOperation) => {
  if (op.kind === "install") {
    return library.symbols.aube_install(ptr(cstr(JSON.stringify(op.options))), null, null)
  }
  return library.symbols.aube_add(
    ptr(cstr(op.projectDir)),
    ptr(cstr(JSON.stringify(op.packages))),
    ptr(cstr(JSON.stringify(op.options))),
    null,
    null,
  )
}

const wait = (handle: bigint | number): FfiResult => {
  const pointer = library.symbols.aube_wait(handle)
  if (!pointer) return { ok: false, code: "ERR_AUBE_FFI_UNKNOWN_HANDLE", message: "aube_wait returned null" }
  const result = JSON.parse(new CString(pointer).toString()) as FfiResult
  library.symbols.aube_string_free(pointer)
  return result
}

declare var self: Worker

self.onmessage = (message: MessageEvent<WorkerRequest>) => {
  const { host, op } = message.data
  library.symbols.aube_init(ptr(cstr(JSON.stringify(host))))
  const handle = start(op)
  postMessage({ kind: "started", handle } satisfies WorkerResponse)
  postMessage({ kind: "result", result: wait(handle) } satisfies WorkerResponse)
}
