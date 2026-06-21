type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  const globalScope = typeof self !== "undefined" ? self : (globalThis as any)
  globalScope.onmessage = async (evt: any) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.request") {
      try {
        const result = await rpc[parsed.method](parsed.input)
        globalScope.postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      } catch (err: any) {
        globalScope.postMessage(JSON.stringify({
          type: "rpc.error",
          error: err?.message || String(err),
          id: parsed.id
        }))
      }
    }
  }
}

export function emit(event: string, data: unknown) {
  const globalScope = typeof self !== "undefined" ? self : (globalThis as any)
  globalScope.postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (err: any) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.result") {
      const promise = pending.get(parsed.id)
      if (promise) {
        promise.resolve(parsed.result)
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.error") {
      const promise = pending.get(parsed.id)
      if (promise) {
        promise.reject(new Error(parsed.error))
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
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
  }
}

export * as Rpc from "./rpc"
