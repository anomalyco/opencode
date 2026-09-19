type Definition = {
  [method: string]: (input: any) => any
}

/**
 * Default ceiling for a single RPC round trip. The worker proxies every local
 * API request, including long model turns, so this is deliberately far above
 * any legitimate request; it exists only to turn a worker that never replies
 * (post-death wedge) into a bounded failure. Pass `{ timeout: 0 }` to wait
 * indefinitely.
 */
const CALL_TIMEOUT_MS = 30 * 60 * 1000

type PendingCall = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

// A malformed or non-JSON frame must never throw out of the listener; any
// frame we cannot read is dropped rather than crashing the worker.
function parse(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== "string") return undefined
  try {
    const frame: unknown = JSON.parse(data)
    if (!frame || typeof frame !== "object") return undefined
    return frame as Record<string, unknown>
  } catch {
    return undefined
  }
}

function toError(error: unknown) {
  if (error instanceof Error) return error
  return new Error(String(error))
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const parsed = parse(evt?.data)
    if (!parsed || parsed.type !== "rpc.request" || typeof parsed.id !== "number") return
    const handler = typeof parsed.method === "string" ? rpc[parsed.method] : undefined
    if (typeof handler !== "function") {
      postMessage(
        JSON.stringify({ type: "rpc.error", error: `Unknown rpc method: ${String(parsed.method)}`, id: parsed.id }),
      )
      return
    }
    // Always settle the caller: a throw here must produce an rpc.error frame,
    // not vanish into the worker's uncaughtException no-op.
    try {
      const result = await handler(parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    } catch (error) {
      postMessage(JSON.stringify({ type: "rpc.error", error: toError(error).message, id: parsed.id }))
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, PendingCall>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  let failure: Error | undefined

  const settle = (requestId: unknown): PendingCall | undefined => {
    if (typeof requestId !== "number") return undefined
    const call = pending.get(requestId)
    if (!call) return undefined
    if (call.timer) clearTimeout(call.timer)
    pending.delete(requestId)
    return call
  }

  // Called by the spawn site when the worker dies. Drains every in-flight call
  // and latches the failure so later calls reject instead of hanging.
  const fail = (error: unknown) => {
    if (failure) return
    failure = toError(error)
    for (const call of pending.values()) {
      if (call.timer) clearTimeout(call.timer)
      call.reject(failure)
    }
    pending.clear()
  }

  target.onmessage = (evt) => {
    const parsed = parse(evt?.data)
    if (!parsed) return
    if (parsed.type === "rpc.result") {
      settle(parsed.id)?.resolve(parsed.result)
      return
    }
    if (parsed.type === "rpc.error") {
      settle(parsed.id)?.reject(toError(parsed.error))
      return
    }
    if (parsed.type === "rpc.event" && typeof parsed.event === "string") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(
      method: Method,
      input: Parameters<T[Method]>[0],
      options?: { timeout?: number },
    ): Promise<ReturnType<T[Method]>> {
      if (failure) return Promise.reject(failure)
      const requestId = id++
      return new Promise((resolve, reject) => {
        const timeout = options?.timeout ?? CALL_TIMEOUT_MS
        const timer =
          timeout > 0
            ? setTimeout(() => {
                settle(requestId)?.reject(new Error(`RPC call "${String(method)}" timed out after ${timeout}ms`))
              }, timeout)
            : undefined
        // A 30-minute timeout must not pin the event loop after every other handle drains.
        if (timer && typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref()
        pending.set(requestId, { resolve, reject, timer })
        try {
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        } catch (error) {
          settle(requestId)?.reject(toError(error))
        }
      })
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
    fail,
  }
}

export * as Rpc from "./rpc"
