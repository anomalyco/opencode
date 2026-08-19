type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.request") {
      // Promise-wrapped so a synchronous throw also lands in .catch() below.
      await new Promise((resolve) => resolve(rpc[parsed.method](parsed.input)))
        .then((result) => postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id })))
        .catch((error) => {
          let message: string
          try {
            message = error instanceof Error ? error.message : String(error)
          } catch {
            message = "Unknown error"
          }
          postMessage(JSON.stringify({ type: "rpc.result", error: message, id: parsed.id }))
        })
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

type WorkerLifecycleEvent = Event & { error?: unknown; message?: string; code?: number }

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  addEventListener?: (type: "error" | "close" | "messageerror", listener: (event: WorkerLifecycleEvent) => void) => void
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: unknown) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  const disconnectHandlers = new Set<(error: Error) => void>()
  let id = 0
  let dead: Error | undefined
  let disconnectExpected = false
  const rejectAllPending = (error: Error) => {
    if (dead || disconnectExpected) return
    dead = error
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    for (const handler of disconnectHandlers) handler(error)
  }
  target.addEventListener?.("error", (event) => {
    rejectAllPending(event?.error instanceof Error ? event.error : new Error(event?.message || "Worker error"))
  })
  target.addEventListener?.("close", (event) => {
    // Code 0 is ambiguous, so only expectDisconnect() marks an intentional shutdown.
    rejectAllPending(
      new Error(`Worker exited unexpectedly${typeof event?.code === "number" ? ` (code ${event.code})` : ""}`),
    )
  })
  target.addEventListener?.("messageerror", () => {
    rejectAllPending(new Error("Worker sent a message that could not be deserialized"))
  })
  target.onmessage = async (evt) => {
    const parsed = (() => {
      try {
        return JSON.parse(evt.data)
      } catch (cause) {
        rejectAllPending(new Error("Worker sent invalid RPC JSON", { cause }))
      }
    })()
    if (parsed === undefined) return
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      rejectAllPending(new Error("Worker sent an invalid RPC message"))
      return
    }
    if (parsed.type === "rpc.result") {
      if (typeof parsed.id !== "number") {
        rejectAllPending(new Error("Worker sent an invalid RPC result"))
        return
      }
      const entry = pending.get(parsed.id)
      if (entry) {
        if ("error" in parsed) entry.reject(new Error(parsed.error))
        else entry.resolve(parsed.result)
        pending.delete(parsed.id)
      }
      return
    }
    if (parsed.type === "rpc.event") {
      if (typeof parsed.event !== "string") {
        rejectAllPending(new Error("Worker sent an invalid RPC event"))
        return
      }
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
      return
    }
    rejectAllPending(new Error("Worker sent an unknown RPC message"))
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        if (dead) return reject(dead)
        pending.set(requestId, { resolve, reject })
        try {
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        } catch (error) {
          pending.delete(requestId)
          reject(error)
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
    onDisconnect(handler: (error: Error) => void) {
      if (dead) {
        handler(dead)
        return () => {}
      }
      disconnectHandlers.add(handler)
      return () => {
        disconnectHandlers.delete(handler)
      }
    },
    expectDisconnect() {
      disconnectExpected = true
    },
  }
}

export * as Rpc from "./rpc"
