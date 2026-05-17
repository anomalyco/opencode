import { expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

test("rpc listener returns handler errors without rejecting the message handler", async () => {
  const global = globalThis as typeof globalThis & {
    onmessage?: (evt: { data: string }) => Promise<void>
    postMessage?: (data: string) => void
  }
  const previousOnMessage = global.onmessage
  const previousPostMessage = global.postMessage
  const messages: string[] = []

  global.postMessage = (data) => messages.push(data)

  try {
    Rpc.listen({
      fail: () => {
        throw new Error("boom")
      },
    })

    await expect(
      global.onmessage?.({
        data: JSON.stringify({ type: "rpc.request", method: "fail", id: 1 }),
      }),
    ).resolves.toBeUndefined()

    expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({
      type: "rpc.error",
      id: 1,
      error: "boom",
    })
  } finally {
    global.onmessage = previousOnMessage
    global.postMessage = previousPostMessage
  }
})

test("rpc client rejects rpc errors and can continue handling later results", async () => {
  const target: {
    postMessage: (data: string) => void
    onmessage: ((evt: { data: string }) => void) | null
  } = {
    postMessage(data) {
      const parsed = JSON.parse(data)
      target.onmessage?.({
        data: JSON.stringify(
          parsed.method === "fail"
            ? { type: "rpc.error", id: parsed.id, error: "boom" }
            : { type: "rpc.result", id: parsed.id, result: "ok" },
        ),
      })
    },
    onmessage: null,
  }
  const client = Rpc.client<{ fail: () => string; ok: () => string }>(target)
  let failed: string | undefined

  void client.call("fail", undefined).catch((error) => {
    failed = error instanceof Error ? error.message : String(error)
  })
  await Promise.resolve()

  expect(failed).toBe("boom")
  await expect(client.call("ok", undefined)).resolves.toBe("ok")
})
