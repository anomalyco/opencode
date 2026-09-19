import { describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

type Methods = Record<string, (input: any) => any>

type Endpoint = {
  postMessage(data: string): void
  onmessage: ((this: Worker, ev: MessageEvent<string>) => unknown) | null
}

function message(data: string) {
  return new MessageEvent("message", { data })
}

function harness(rpc: Methods) {
  const main: Endpoint = {
    onmessage: null,
    postMessage(data) {
      queueMicrotask(() => worker.onmessage?.call({} as Worker, message(data)))
    },
  }
  const worker: Endpoint = {
    onmessage: null,
    postMessage(data) {
      queueMicrotask(() => main.onmessage?.call({} as Worker, message(data)))
    },
  }
  const previousOnMessage = globalThis.onmessage
  const previousPostMessage = globalThis.postMessage
  globalThis.postMessage = worker.postMessage
  Rpc.listen(rpc)
  worker.onmessage = globalThis.onmessage as Endpoint["onmessage"]
  const client = Rpc.client<Methods>(main)
  return {
    client,
    main,
    worker,
    dispose() {
      globalThis.onmessage = previousOnMessage
      globalThis.postMessage = previousPostMessage
    },
  }
}

function silent() {
  const sent: { id: number; method: string }[] = []
  const target: Endpoint = {
    onmessage: null,
    postMessage(data) {
      sent.push(JSON.parse(data))
    },
  }
  return { client: Rpc.client<Methods>(target), sent, target }
}

function send(target: Endpoint, frame: Record<string, unknown>) {
  target.onmessage?.call({} as Worker, message(JSON.stringify(frame)))
}

describe("util.rpc", () => {
  test("rejects when a handler throws", async () => {
    const rpc = harness({
      boom() {
        throw new Error("boom")
      },
    })
    try {
      await expect(rpc.client.call("boom", undefined)).rejects.toThrow("boom")
    } finally {
      rpc.dispose()
    }
  })

  test("rejects unknown methods instead of hanging", async () => {
    const rpc = harness({})
    try {
      await expect(rpc.client.call("missing", undefined)).rejects.toThrow("Unknown rpc method: missing")
    } finally {
      rpc.dispose()
    }
  })

  test("drains two in-flight calls on worker death and rejects later calls", async () => {
    const rpc = harness({
      hang() {
        return new Promise(() => {})
      },
    })
    try {
      const first = rpc.client.call("hang", undefined)
      const second = rpc.client.call("hang", undefined)
      rpc.client.fail(new Error("worker died"))
      await expect(first).rejects.toThrow("worker died")
      await expect(second).rejects.toThrow("worker died")
      await expect(rpc.client.call("hang", undefined)).rejects.toThrow("worker died")
    } finally {
      rpc.dispose()
    }
  })

  test("times out a call that never settles", async () => {
    const rpc = harness({
      hang() {
        return new Promise(() => {})
      },
    })
    try {
      await expect(rpc.client.call("hang", undefined, { timeout: 20 })).rejects.toThrow("timed out after 20ms")
    } finally {
      rpc.dispose()
    }
  })

  test("ignores malformed frames and still serves the next call", async () => {
    const rpc = harness({
      ok() {
        return "fine"
      },
    })
    try {
      rpc.main.onmessage?.call({} as Worker, message("not json"))
      rpc.worker.onmessage?.call({} as Worker, message("{ also not json"))
      await expect(rpc.client.call("ok", undefined)).resolves.toBe("fine")
    } finally {
      rpc.dispose()
    }
  })

  test("resolves concurrent calls independently when responses arrive out of order", async () => {
    const { client, sent, target } = silent()
    const first = client.call("first", undefined)
    const second = client.call("second", undefined)
    send(target, { type: "rpc.result", id: sent[1].id, result: "two" })
    send(target, { type: "rpc.result", id: sent[0].id, result: "one" })
    await expect(first).resolves.toBe("one")
    await expect(second).resolves.toBe("two")
  })

  test("ignores a response that arrives after the call timed out", async () => {
    const { client, sent, target } = silent()
    await expect(client.call("slow", undefined, { timeout: 10 })).rejects.toThrow("timed out after 10ms")
    send(target, { type: "rpc.result", id: sent[0].id, result: "late" })
    const next = client.call("next", undefined)
    send(target, { type: "rpc.result", id: sent[1].id, result: "ok" })
    await expect(next).resolves.toBe("ok")
  })

  test("keeps the first failure when fail is called twice", async () => {
    const { client } = silent()
    const call = client.call("hang", undefined)
    client.fail(new Error("first"))
    client.fail(new Error("second"))
    await expect(call).rejects.toThrow("first")
    await expect(client.call("hang", undefined)).rejects.toThrow("first")
  })
})
