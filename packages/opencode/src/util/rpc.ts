export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  /** Default timeout for RPC calls in milliseconds (30 seconds) */
  const DEFAULT_TIMEOUT = 30_000

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        const result = await rpc[parsed.method](parsed.input)
        postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      }
    }
  }

  type PendingRequest = {
    resolve: (result: any) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }

  export function client<T extends Definition>(
    target: {
      postMessage: (data: string) => void | null
      onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
    },
    options?: { timeout?: number },
  ) {
    const pending = new Map<number, PendingRequest>()
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT
    let id = 0

    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.result") {
        const request = pending.get(parsed.id)
        if (request) {
          clearTimeout(request.timeout)
          pending.delete(parsed.id)
          request.resolve(parsed.result)
        }
      }
    }

    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        const requestId = id++
        return new Promise((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            const request = pending.get(requestId)
            if (request) {
              pending.delete(requestId)
              reject(new Error(`RPC call '${String(method)}' timed out after ${timeout}ms`))
            }
          }, timeout)

          pending.set(requestId, {
            resolve,
            reject,
            timeout: timeoutHandle,
          })
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        })
      },
      /** Get count of pending requests (for testing/monitoring) */
      pendingCount(): number {
        return pending.size
      },
      /** Clear all pending requests (for cleanup) */
      dispose(): void {
        for (const [requestId, request] of pending) {
          clearTimeout(request.timeout)
          request.reject(new Error("RPC client disposed"))
        }
        pending.clear()
      },
    }
  }
}
