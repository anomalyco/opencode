import { describe, expect, test, beforeEach, mock } from "bun:test"
import { Rpc } from "../../src/util/rpc"

describe("Rpc", () => {
  describe("client", () => {
    test("call resolves when response is received", async () => {
      const messages: string[] = []
      const target = {
        postMessage: (data: string) => {
          messages.push(data)
        },
        onmessage: null as ((this: Worker, ev: MessageEvent<any>) => any) | null,
      }

      const client = Rpc.client<{ add: (input: { a: number; b: number }) => number }>(target)

      const promise = client.call("add", { a: 1, b: 2 })

      // Simulate response
      const request = JSON.parse(messages[0])
      target.onmessage?.call(
        {} as Worker,
        new MessageEvent("message", {
          data: JSON.stringify({ type: "rpc.result", result: 3, id: request.id }),
        }),
      )

      const result = await promise
      expect(result).toBe(3)
      expect(client.pendingCount()).toBe(0)
    })

    test("call rejects with timeout error when no response", async () => {
      const target = {
        postMessage: () => {},
        onmessage: null as ((this: Worker, ev: MessageEvent<any>) => any) | null,
      }

      const client = Rpc.client<{ slow: (input: {}) => void }>(target, { timeout: 50 })

      const start = Date.now()
      await expect(client.call("slow", {})).rejects.toThrow("timed out after 50ms")
      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(45)
      expect(elapsed).toBeLessThan(200)
      expect(client.pendingCount()).toBe(0)
    })

    test("pendingCount tracks pending requests", async () => {
      const target = {
        postMessage: () => {},
        onmessage: null as ((this: Worker, ev: MessageEvent<any>) => any) | null,
      }

      const client = Rpc.client<{ op: (input: {}) => void }>(target, { timeout: 1000 })

      expect(client.pendingCount()).toBe(0)

      // Start multiple calls without resolving
      const p1 = client.call("op", {}).catch(() => {})
      expect(client.pendingCount()).toBe(1)

      const p2 = client.call("op", {}).catch(() => {})
      expect(client.pendingCount()).toBe(2)

      // Dispose should clear all
      client.dispose()
      expect(client.pendingCount()).toBe(0)

      await Promise.all([p1, p2])
    })

    test("dispose rejects pending requests", async () => {
      const target = {
        postMessage: () => {},
        onmessage: null as ((this: Worker, ev: MessageEvent<any>) => any) | null,
      }

      const client = Rpc.client<{ op: (input: {}) => void }>(target, { timeout: 10000 })

      const promise = client.call("op", {})
      client.dispose()

      await expect(promise).rejects.toThrow("RPC client disposed")
    })

    test("multiple calls get correct responses", async () => {
      const messages: string[] = []
      const target = {
        postMessage: (data: string) => {
          messages.push(data)
        },
        onmessage: null as ((this: Worker, ev: MessageEvent<any>) => any) | null,
      }

      const client = Rpc.client<{ double: (input: { n: number }) => number }>(target)

      const p1 = client.call("double", { n: 5 })
      const p2 = client.call("double", { n: 10 })

      expect(client.pendingCount()).toBe(2)

      // Respond in reverse order
      const req1 = JSON.parse(messages[0])
      const req2 = JSON.parse(messages[1])

      target.onmessage?.call(
        {} as Worker,
        new MessageEvent("message", {
          data: JSON.stringify({ type: "rpc.result", result: 20, id: req2.id }),
        }),
      )

      target.onmessage?.call(
        {} as Worker,
        new MessageEvent("message", {
          data: JSON.stringify({ type: "rpc.result", result: 10, id: req1.id }),
        }),
      )

      expect(await p1).toBe(10)
      expect(await p2).toBe(20)
      expect(client.pendingCount()).toBe(0)
    })
  })
})
