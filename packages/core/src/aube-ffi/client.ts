// Client for aube's C ABI (@jdxcode/aube-ffi). Each operation gets its own
// worker because aube_wait blocks the thread that calls it; cancellation goes
// through aube_cancel on the main thread using the handle the worker posts
// back before waiting.
import type { FfiOperation, FfiResult, WorkerRequest, WorkerResponse } from "./protocol"

export class AubeFfiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "AubeFfiError"
  }
}

const host = { name: "opencode", version: "1.0.0" }

// The Node-API addon maps the project .npmrc's `omit` entries to dependency
// selection itself; the C ABI leaves that to the host, so mirror it here.
export const npmrcDepFlags = async (projectDir: string) => {
  const path = await import("path")
  const flags: { prodOnly?: boolean; omitOptional?: boolean } = {}
  const text = await import("fs/promises")
    .then((fsp) => fsp.readFile(path.join(projectDir, ".npmrc"), "utf8"))
    .catch(() => "")
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*omit(\[\])?\s*=\s*(.*)$/)
    if (!match) continue
    for (const value of match[2].split(/[\s,]+/)) {
      if (value === "dev") flags.prodOnly = true
      if (value === "optional") flags.omitOptional = true
    }
  }
  return flags
}

let cancelSymbol: ((handle: bigint | number) => number) | undefined

const cancel = async (handle: bigint | number) => {
  if (!cancelSymbol) {
    const { dlopen } = await import("bun:ffi")
    const { libraryPath } = await import("@jdxcode/aube-ffi")
    cancelSymbol = dlopen(libraryPath, {
      aube_cancel: { args: ["u64"], returns: "i32" },
    }).symbols.aube_cancel as (handle: bigint | number) => number
  }
  cancelSymbol(handle)
}

export const run = (op: FfiOperation, signal?: AbortSignal): Promise<FfiResult> =>
  new Promise<FfiResult>((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url))
    let handle: bigint | number | undefined
    let aborted = false

    const onAbort = () => {
      aborted = true
      if (handle !== undefined) void cancel(handle)
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    const finish = (act: () => void) => {
      signal?.removeEventListener("abort", onAbort)
      worker.terminate()
      act()
    }

    worker.onmessage = (message: MessageEvent<WorkerResponse>) => {
      const data = message.data
      if (data.kind === "started") {
        handle = data.handle
        if (aborted) void cancel(handle)
        return
      }
      finish(() => resolve(data.result))
    }
    worker.onerror = (event) => {
      finish(() => reject(new AubeFfiError("ERR_AUBE_FFI_WORKER", event.message ?? "aube ffi worker failed")))
    }

    worker.postMessage({ host, op } satisfies WorkerRequest)
  }).then((result) => {
    if (!result.ok) throw new AubeFfiError(result.code ?? "ERR_AUBE_FFI_RUNTIME", result.message ?? "install failed")
    return result
  })
