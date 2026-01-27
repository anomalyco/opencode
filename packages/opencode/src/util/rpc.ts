export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        try {
          const result = await rpc[parsed.method](parsed.input)
          postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } catch (error) {
          // Send error back to client instead of silently failing
          postMessage(JSON.stringify({ 
            type: "rpc.error", 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            id: parsed.id 
          }))
        }
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
    type PendingEntry = {
      resolve: (result: any) => void
      reject: (error: Error) => void
      timeoutId: NodeJS.Timeout
    }
    
    const pending = new Map<number, PendingEntry>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    
    // Configuration
    const REQUEST_TIMEOUT_MS = 60000 // 60 seconds
    const MAX_PENDING_REQUESTS = 1000
    
    // Clean up request
    const cleanupRequest = (requestId: number) => {
      const entry = pending.get(requestId)
      if (entry) {
        clearTimeout(entry.timeoutId)
        pending.delete(requestId)
      }
    }
    
    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      
      // Handle successful response
      if (parsed.type === "rpc.result") {
        const entry = pending.get(parsed.id)
        if (entry) {
          entry.resolve(parsed.result)
          cleanupRequest(parsed.id)
        }
      }
      
      // Handle error response - NEW!
      if (parsed.type === "rpc.error") {
        const entry = pending.get(parsed.id)
        if (entry) {
          const error = new Error(parsed.error || "RPC call failed")
          if (parsed.stack) {
            error.stack = parsed.stack
          }
          entry.reject(error)
          cleanupRequest(parsed.id)
        }
      }
      
      // Handle events
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
        
        // Check if we've exceeded max pending requests
        if (pending.size >= MAX_PENDING_REQUESTS) {
          return Promise.reject(new Error(`RPC queue full: ${pending.size} pending requests`))
        }
        
        return new Promise((resolve, reject) => {
          // Set timeout for this request
          const timeoutId = setTimeout(() => {
            if (pending.has(requestId)) {
              cleanupRequest(requestId)
              reject(new Error(`RPC call '${String(method)}' timed out after ${REQUEST_TIMEOUT_MS}ms`))
            }
          }, REQUEST_TIMEOUT_MS)
          
          pending.set(requestId, { resolve, reject, timeoutId })
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        })
      },
      
      // Reject all pending requests (call on worker error)
      rejectAll(error: Error) {
        for (const [requestId, entry] of pending) {
          entry.reject(error)
          clearTimeout(entry.timeoutId)
        }
        pending.clear()
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
}
