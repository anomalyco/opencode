import { describe, expect, test, afterEach } from "bun:test"
import { Rpc } from "../../src/util/rpc"

describe("util.rpc", () => {
  const originalOnmessage = (globalThis as any).onmessage
  const originalPostMessage = (globalThis as any).postMessage

  afterEach(() => {
    ;(globalThis as any).onmessage = originalOnmessage
    ;(globalThis as any).postMessage = originalPostMessage
  })

  test("listen replies with an error instead of hanging when a handler throws", async () => {
    const sent: any[] = []
    ;(globalThis as any).postMessage = (data: string) => sent.push(JSON.parse(data))

    Rpc.listen({
      boom: async () => {
        throw new Error("no such column: name")
      },
    })

    await (globalThis as any).onmessage({
      data: JSON.stringify({ type: "rpc.request", method: "boom", input: undefined, id: 1 }),
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: "rpc.result", id: 1, error: "no such column: name" })
  })

  test("listen falls back to a safe message when the thrown value cannot be stringified", async () => {
    const sent: any[] = []
    ;(globalThis as any).postMessage = (data: string) => sent.push(JSON.parse(data))
    const unstringifiable = new Proxy(
      {},
      {
        get() {
          throw new Error("nope")
        },
      },
    )

    Rpc.listen({
      boom: async () => {
        throw unstringifiable
      },
    })

    await (globalThis as any).onmessage({
      data: JSON.stringify({ type: "rpc.request", method: "boom", input: undefined, id: 2 }),
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: "rpc.result", id: 2, error: "Unknown error" })
  })

  test("client.call rejects instead of hanging forever when the reply carries an error", async () => {
    const target = { postMessage: (_data: string) => {}, onmessage: null as any }
    const client = Rpc.client<{ boom: (input: undefined) => void }>(target)

    queueMicrotask(() => {
      target.onmessage!({
        data: JSON.stringify({ type: "rpc.result", id: 0, error: "no such column: name" }),
      })
    })

    await expect(client.call("boom", undefined)).rejects.toThrow("no such column: name")
  })

  test("client.call still resolves normally for a successful reply", async () => {
    const target = { postMessage: (_data: string) => {}, onmessage: null as any }
    const client = Rpc.client<{ ping: (input: undefined) => string }>(target)

    queueMicrotask(() => {
      target.onmessage!({
        data: JSON.stringify({ type: "rpc.result", id: 0, result: "pong" }),
      })
    })

    await expect(client.call("ping", undefined)).resolves.toBe("pong")
  })

  test("client.call rejects instead of hanging when postMessage throws synchronously", async () => {
    const target = {
      postMessage: (_data: string) => {
        throw new Error("channel closed")
      },
      onmessage: null as any,
    }
    const client = Rpc.client<{ boom: (input: undefined) => void }>(target)

    await expect(client.call("boom", undefined)).rejects.toThrow("channel closed")
  })

  function createFakeWorker() {
    const target = new EventTarget() as EventTarget & {
      postMessage: (data: string) => void
      onmessage: ((ev: MessageEvent) => any) | null
    }
    target.postMessage = () => {}
    target.onmessage = null
    return target
  }

  test("an in-flight call rejects instead of hanging forever when the worker crashes", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    worker.dispatchEvent(new ErrorEvent("error", { error: new Error("segfault") }))

    await expect(pending).rejects.toThrow("segfault")
  })

  test("an in-flight call rejects instead of hanging forever when a real Bun Worker crashes", async () => {
    const file = new URL("../fixture/crashing-worker.ts", import.meta.url)
    const worker = new Worker(file)
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    try {
      await expect(pending).rejects.toThrow("Worker crashed on purpose")
    } finally {
      worker.terminate()
    }
  })

  test("an in-flight call rejects instead of hanging forever when the worker exits unexpectedly", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    worker.dispatchEvent(new CloseEvent("close", { code: 1 }))

    await expect(pending).rejects.toThrow(/exited unexpectedly/)
  })

  test("an in-flight call rejects instead of hanging forever when the worker sends an undeserializable message", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    worker.dispatchEvent(new MessageEvent("messageerror"))

    await expect(pending).rejects.toThrow(/could not be deserialized/)
  })

  test("an in-flight call rejects when the worker sends invalid RPC JSON", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    worker.onmessage?.(new MessageEvent("message", { data: "not json" }))

    await expect(pending).rejects.toThrow("invalid RPC JSON")
  })

  test("an in-flight call rejects when the worker sends an invalid RPC envelope", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    worker.onmessage?.(new MessageEvent("message", { data: "null" }))

    await expect(pending).rejects.toThrow("invalid RPC message")
  })

  test("an in-flight call rejects when the worker sends an unknown RPC message", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const pending = client.call("fetch", undefined)
    worker.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "unknown" }) }))

    await expect(pending).rejects.toThrow("unknown RPC message")
  })

  test("a call made after the worker has already died rejects immediately instead of hanging", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    worker.dispatchEvent(new CloseEvent("close", { code: 1 }))

    await expect(client.call("fetch", undefined)).rejects.toThrow(/exited unexpectedly/)
  })

  test("onDisconnect fires even when the worker dies with nothing in flight", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const seen: Error[] = []
    client.onDisconnect((error) => seen.push(error))

    worker.dispatchEvent(new ErrorEvent("error", { error: new Error("segfault") }))

    expect(seen).toHaveLength(1)
    expect(seen[0].message).toBe("segfault")
  })

  test("onDisconnect does not fire once expectDisconnect() has been called", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const seen: Error[] = []
    client.onDisconnect((error) => seen.push(error))

    client.expectDisconnect()
    worker.dispatchEvent(new CloseEvent("close", { code: 0 }))

    expect(seen).toHaveLength(0)
  })

  test("an unexpected exit with code 0 is fatal without expectDisconnect()", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    const seen: Error[] = []
    client.onDisconnect((error) => seen.push(error))

    worker.dispatchEvent(new CloseEvent("close", { code: 0 }))

    expect(seen).toHaveLength(1)
  })

  test("a crash during an in-flight call is not suppressed just because expectDisconnect() follows shortly after", async () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ shutdown: (input: undefined) => void }>(worker)

    const pending = client.call("shutdown", undefined)
    worker.dispatchEvent(new CloseEvent("close", { code: 1 }))
    await expect(pending).rejects.toThrow(/exited unexpectedly/)

    expect(() => client.expectDisconnect()).not.toThrow()
  })

  test("onDisconnect invokes a handler registered after the worker already died", () => {
    const worker = createFakeWorker()
    const client = Rpc.client<{ fetch: (input: undefined) => void }>(worker)

    worker.dispatchEvent(new CloseEvent("close", { code: 1 }))

    const seen: Error[] = []
    client.onDisconnect((error) => seen.push(error))

    expect(seen).toHaveLength(1)
  })
})
