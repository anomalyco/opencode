import { errorMessage } from "@/util/error"

type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type !== "rpc.request") return
    // A request that throws must still be answered, or its caller waits forever.
    const reply = await Promise.resolve()
      .then(() => rpc[parsed.method](parsed.input))
      .then(
        (result) => ({ type: "rpc.result", result, id: parsed.id }),
        (error) => ({
          type: "rpc.result",
          // Some failures keep their text on the cause: a taken --port rejects with an empty ServeError.
          error: errorMessage(error instanceof Error && !error.message && error.cause ? error.cause : error),
          id: parsed.id,
        }),
      )
    postMessage(JSON.stringify(reply))
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.result") {
      const request = pending.get(parsed.id)
      if (request) {
        pending.delete(parsed.id)
        if (typeof parsed.error === "string") request.reject(new Error(parsed.error))
        else request.resolve(parsed.result)
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
