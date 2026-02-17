export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  export interface Transport {
    send(msg: any): void
    receive(handler: (msg: any) => void): void
  }

  export function process(): Transport {
    return {
      send(msg) {
        globalThis.process.send!(msg)
      },
      receive(handler) {
        globalThis.process.on("message", handler)
      },
    }
  }

  export function worker(w: Worker): Transport {
    return {
      send(msg) {
        w.postMessage(msg)
      },
      receive(handler) {
        w.addEventListener("message", (e: MessageEvent) => handler(e.data))
      },
    }
  }

  export function self(): Transport {
    return {
      send(msg) {
        postMessage(msg)
      },
      receive(handler) {
        addEventListener("message", (e: MessageEvent) => handler(e.data))
      },
    }
  }

  export function ipc() {
    const handlers = new Set<(msg: any) => void>()
    return {
      transport(send: (msg: any) => void): Transport {
        return {
          send,
          receive(handler) {
            handlers.add(handler)
          },
        }
      },
      dispatch(msg: any) {
        for (const handler of handlers) handler(msg)
      },
    }
  }

  export function listen(rpc: Definition, transport: Transport) {
    transport.receive(async (msg) => {
      if (msg.type === "rpc.request") {
        const result = await rpc[msg.method](msg.input)
        transport.send({ type: "rpc.result", result, id: msg.id })
      }
    })
  }

  export function emit(event: string, data: unknown, transport: Transport) {
    transport.send({ type: "rpc.event", event, data })
  }

  export function client<T extends Definition>(transport: Transport) {
    const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    let invalidated = false
    transport.receive((msg) => {
      if (msg.type === "rpc.result") {
        const p = pending.get(msg.id)
        if (p) {
          p.resolve(msg.result)
          pending.delete(msg.id)
        }
      }
      if (msg.type === "rpc.event") {
        const handlers = listeners.get(msg.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(msg.data)
          }
        }
      }
    })
    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        if (invalidated) return Promise.reject(new Error("client invalidated"))
        const requestId = id++
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject })
          transport.send({ type: "rpc.request", method, input, id: requestId })
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
      invalidate() {
        invalidated = true
        const error = new Error("worker shutting down")
        for (const [, p] of pending) {
          p.reject(error)
        }
        pending.clear()
        listeners.clear()
      },
    }
  }
}
