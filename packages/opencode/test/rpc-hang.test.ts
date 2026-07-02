import { Rpc } from "../src/util/rpc"
import { describe, it, expect, mock } from "bun:test"

describe("Rpc.client", () => {
  it("rejects pending calls when target disconnects (error event)", async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const target = {
      postMessage: mock(() => {}),
      onmessage: null as any,
      addEventListener(event: string, handler: (...args: any[]) => void) {
        let set = listeners.get(event)
        if (!set) {
          set = new Set()
          listeners.set(event, set)
        }
        set.add(handler)
      },
    }

    const client = Rpc.client<{ ping: (input: {}) => string }>(target as any)
    const call = client.call("ping", {})

    const errorHandler = listeners.get("error")?.values().next().value
    errorHandler?.(new ErrorEvent("error", { message: "worker crashed" }))

    await expect(call).rejects.toThrow("RPC target disconnected")
  })

  it("rejects pending calls on messageerror", async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const target = {
      postMessage: mock(() => {}),
      onmessage: null as any,
      addEventListener(event: string, handler: (...args: any[]) => void) {
        let set = listeners.get(event)
        if (!set) {
          set = new Set()
          listeners.set(event, set)
        }
        set.add(handler)
      },
    }

    const client = Rpc.client<{ ping: (input: {}) => string }>(target as any)
    const call = client.call("ping", {})

    const errorHandler = listeners.get("messageerror")?.values().next().value
    errorHandler?.(new MessageEvent("messageerror"))

    await expect(call).rejects.toThrow("RPC target disconnected")
  })

  it("rejects calls made after target already disconnected", async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const target = {
      postMessage: mock(() => {}),
      onmessage: null as any,
      addEventListener(event: string, handler: (...args: any[]) => void) {
        let set = listeners.get(event)
        if (!set) {
          set = new Set()
          listeners.set(event, set)
        }
        set.add(handler)
      },
    }

    const client = Rpc.client<{ ping: (input: {}) => string }>(target as any)

    // First call: worker dies
    const call1 = client.call("ping", {})
    const errorHandler = listeners.get("error")?.values().next().value
    errorHandler?.(new ErrorEvent("error", { message: "worker crashed" }))
    await expect(call1).rejects.toThrow("RPC target disconnected")

    // Second call: made after already disconnected
    const call2 = client.call("ping", {})
    await expect(call2).rejects.toThrow("RPC target disconnected")
  })

  it("resolves normally when target responds", async () => {
    const target = {
      postMessage: mock((data: string) => {
        const parsed = JSON.parse(data)
        if (parsed.type === "rpc.request") {
          setImmediate(() => {
            target.onmessage?.({ data: JSON.stringify({ type: "rpc.result", result: "pong", id: parsed.id }) })
          })
        }
      }),
      onmessage: null as any,
    }

    const client = Rpc.client<{ ping: (input: {}) => string }>(target as any)
    const result = await client.call("ping", {})

    expect(result).toBe("pong")
    expect(target.postMessage).toHaveBeenCalledTimes(1)
  })

  it("rejects when a real Bun Worker throws an uncaught error", async () => {
    const file = new URL("./fixture/crashing-worker.ts", import.meta.url)
    const worker = new Worker(file)
    const client = Rpc.client<{ ping: (input: {}) => string }>(worker)

    // Give the worker time to boot and throw
    await new Promise((resolve) => setTimeout(resolve, 200))

    const call = client.call("ping", {})
    await expect(call).rejects.toThrow("RPC target disconnected")
    worker.terminate()
  })
})
