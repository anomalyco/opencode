// Client for aube's C ABI (@jdxcode/aube-ffi). Each operation gets its own
// worker because aube_wait blocks the thread that calls it; cancellation and
// event polling happen on the main thread using the handle the worker posts
// back before waiting. Bun cannot receive FFI callbacks on aube's threads, so
// progress arrives through the polled transport: operations start with
// bufferEvents and the main thread drains aube_events_next while the worker
// blocks — the docs bless polling from a different thread than the waiter,
// and once aube_wait consumes the handle the drain naturally ends on null.
import type { FfiOperation, FfiResult, InstallEvent, WorkerRequest, WorkerResponse } from "./protocol"
import { resolveLibraryPath } from "./library"

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

// Main-thread view of the library: cancellation plus the polled event queue.
// bun:ffi loads lazily so importing this module never breaks non-Bun hosts.
type MainThreadLibrary = {
  symbols: {
    aube_cancel: (handle: bigint | number) => number
    aube_events_next: (handle: bigint | number) => unknown
    aube_string_free: (pointer: unknown) => void
  }
  readCString: (pointer: unknown) => string
}

let mainThreadLibrary: Promise<MainThreadLibrary> | undefined

const openMainThreadLibrary = () => {
  mainThreadLibrary ??= (async () => {
    const { CString, dlopen } = await import("bun:ffi")
    const { symbols } = dlopen(await resolveLibraryPath(), {
      aube_cancel: { args: ["u64"], returns: "i32" },
      aube_events_next: { args: ["u64"], returns: "ptr" },
      aube_string_free: { args: ["ptr"], returns: "void" },
    })
    return {
      symbols: symbols as MainThreadLibrary["symbols"],
      readCString: (pointer) => new CString(pointer as never).toString(),
    } satisfies MainThreadLibrary
  })()
  return mainThreadLibrary
}

const cancel = async (handle: bigint | number) => {
  const { symbols } = await openMainThreadLibrary()
  symbols.aube_cancel(handle)
}

const POLL_INTERVAL_MS = 50

const isTerminal = (event: InstallEvent) =>
  (event.kind === "phase" && event.phase === "complete") || (event.kind === "output" && event.level === "error")

// Best-effort overlay: drains buffered events until the handle is consumed or
// stop() is called. Never blocks the operation — the worker's aube_wait is the
// sole authority on completion, so a queue that goes quiet costs nothing.
const pollEvents = (handle: bigint | number, deliver: (event: InstallEvent) => void) => {
  let stopped = false
  void (async () => {
    const { symbols, readCString } = await openMainThreadLibrary()
    for (;;) {
      if (stopped) return
      for (;;) {
        const raw = symbols.aube_events_next(handle)
        if (!raw) break
        const text = readCString(raw)
        symbols.aube_string_free(raw)
        deliver(JSON.parse(text) as InstallEvent)
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  })()
  return () => {
    stopped = true
  }
}

const withBufferedEvents = (op: FfiOperation): FfiOperation =>
  op.kind === "install"
    ? { ...op, options: { ...op.options, bufferEvents: true } }
    : { ...op, options: { ...op.options, bufferEvents: true } }

export const run = (
  op: FfiOperation,
  signal?: AbortSignal,
  onEvent?: (event: InstallEvent) => void,
): Promise<FfiResult> =>
  new Promise<FfiResult>((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url))
    let handle: bigint | number | undefined
    let stopPolling: (() => void) | undefined
    let aborted = false
    let sawTerminal = false

    const deliver =
      onEvent &&
      ((event: InstallEvent) => {
        sawTerminal ||= isTerminal(event)
        try {
          onEvent(event)
        } catch {
          // A throwing host callback must not tear down event delivery or the
          // operation; drop the event and keep draining.
        }
      })

    const onAbort = () => {
      aborted = true
      if (handle !== undefined) void cancel(handle)
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    const finish = (act: () => void) => {
      signal?.removeEventListener("abort", onAbort)
      stopPolling?.()
      worker.terminate()
      act()
    }

    worker.onmessage = (message: MessageEvent<WorkerResponse>) => {
      const data = message.data
      if (data.kind === "started") {
        handle = data.handle
        if (aborted) void cancel(handle)
        else if (deliver) stopPolling = pollEvents(handle, deliver)
        return
      }
      // Events still buffered when aube_wait returns are discarded with the
      // handle, so the stream's tail — including the terminal event — can fall
      // inside the last poll window. Consumers key UI state off the terminal
      // event (Node-API parity), so synthesize it from the authoritative
      // result when the stream didn't deliver one.
      if (deliver && !sawTerminal) {
        deliver(
          data.result.ok
            ? { kind: "phase", phase: "complete" }
            : { kind: "output", level: "error", code: data.result.code, message: data.result.message ?? "install failed" },
        )
      }
      finish(() => resolve(data.result))
    }
    worker.onerror = (event) => {
      finish(() => reject(new AubeFfiError("ERR_AUBE_FFI_WORKER", event.message ?? "aube ffi worker failed")))
    }

    worker.postMessage({ host, op: onEvent ? withBufferedEvents(op) : op } satisfies WorkerRequest)
  }).then((result) => {
    if (!result.ok) throw new AubeFfiError(result.code ?? "ERR_AUBE_FFI_RUNTIME", result.message ?? "install failed")
    return result
  })
