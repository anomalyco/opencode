import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

type GlobalFrame = { frameId?: string; directory?: string; payload?: { type?: string; syncEvent?: unknown } }

function pump(response: Response) {
  const events: GlobalFrame[] = []
  const waiters: (() => void)[] = []
  const decoder = new TextDecoder()
  const reader = response.body!.getReader()
  let buffer = ""

  const run = async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split("\n\n")
      buffer = frames.pop() ?? ""
      for (const frame of frames) {
        const lines = frame.split("\n")
        const idLine = lines.find((entry) => entry.startsWith("id: "))
        const dataLine = lines.find((entry) => entry.startsWith("data: "))
        if (dataLine)
          events.push({
            frameId: idLine?.slice("id: ".length),
            ...JSON.parse(dataLine.slice("data: ".length)),
          })
      }
      waiters.splice(0).forEach((resolve) => resolve())
    }
  }
  void run()

  const find = async (predicate: (event: GlobalFrame) => boolean, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = events.find(predicate)
      if (hit) return hit
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10)
        waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    throw new Error("timed out waiting for event")
  }

  return { find, stop: () => reader.cancel().catch(() => {}) }
}

// Wait until the handler has attached its GlobalBus listener before emitting, so
// the test never races the lazy stream acquisition.
async function waitForListener(previous: number) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (GlobalBus.listenerCount("event") > previous) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("global event listener was never registered")
}

describe("global event HttpApi", () => {
  test("forwards global bus events and sync mirrors to a connected client", async () => {
    const previous = GlobalBus.listenerCount("event")
    const controller = new AbortController()
    const response = await Server.Default().app.request(GlobalPaths.event, { signal: controller.signal })
    const stream = pump(response)
    try {
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/event-stream")
      expect(await stream.find((event) => event.payload?.type === "server.connected")).toBeDefined()

      await waitForListener(previous)

      GlobalBus.emit("event", {
        directory: "global",
        payload: { id: "evt_test_plain", type: "session.created", properties: {} },
      })
      expect(await stream.find((event) => event.payload?.type === "session.created")).toMatchObject({
        frameId: "evt_test_plain",
        directory: "global",
      })

      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: "sync",
          syncEvent: { id: "evt_test_sync", type: "session.created.1", seq: 1, aggregateID: "ses_test", data: {} },
        },
      })
      // `sync` payloads are part of the declared GlobalEvent contract and are
      // replayed by remote workspace sync, so they must reach the client.
      expect(await stream.find((event) => event.payload?.type === "sync")).toMatchObject({
        payload: { type: "sync" },
      })
    } finally {
      controller.abort()
      stream.stop()
    }
  })
})
