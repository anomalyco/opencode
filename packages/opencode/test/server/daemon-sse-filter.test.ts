import { afterEach, describe, expect, test } from "bun:test"
import { GlobalRoutes } from "../../src/server/routes/global"
import { GlobalBus } from "../../src/bus/global"
import { parseSSE } from "../../src/control-plane/sse"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

type SSEEvent = { directory?: string; payload: { type: string; properties: Record<string, unknown> } }

function emitGlobalEvent(payload: { type: string; properties: Record<string, unknown> }) {
  GlobalBus.emit("event", { directory: "test", payload })
}

async function collectSSE(
  app: ReturnType<typeof GlobalRoutes>,
  query: string,
  emitFn: () => void,
  opts?: { collectCount?: number; timeoutMs?: number },
) {
  const stop = new AbortController()
  const seen: unknown[] = []
  const collectCount = opts?.collectCount ?? 1
  const timeoutMs = opts?.timeoutMs ?? 3000

  try {
    const response = await app.request(`/event${query}`, { signal: stop.signal })
    expect(response.status).toBe(200)
    expect(response.body).toBeDefined()

    const done = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), timeoutMs)
      let emitted = false
      void parseSSE(response.body!, stop.signal, (event) => {
        const e = event as { payload?: { type?: string } }
        if (e.payload?.type === "server.connected") {
          if (!emitted) {
            emitted = true
            setTimeout(emitFn, 50)
          }
          return
        }
        seen.push(e)
        if (seen.length >= collectCount) {
          clearTimeout(timeout)
          resolve()
        }
      }).catch(() => {})
    })

    await done
    return seen
  } finally {
    stop.abort()
  }
}

describe("SSE filter with session.created event shape", () => {
  test("session.created passes when info.id matches filter", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(app, "?sessionID=ses_target", () => {
      emitGlobalEvent({
        type: "session.created",
        properties: { info: { id: "ses_target", slug: "test-session" } },
      })
    })

    expect(seen.length).toBe(1)
    const payload = (seen[0] as SSEEvent).payload
    expect(payload.type).toBe("session.created")
  })

  test("session.created blocked when info.id does not match filter", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "?sessionID=ses_target",
      () => {
        emitGlobalEvent({
          type: "session.created",
          properties: { info: { id: "ses_other" } },
        })
      },
      { collectCount: 1 },
    )

    expect(seen.length).toBe(0)
  })
})

describe("SSE filter with message.updated event shape", () => {
  test("message.updated passes when info.sessionID matches", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(app, "?sessionID=ses_target", () => {
      emitGlobalEvent({
        type: "message.updated",
        properties: { info: { sessionID: "ses_target", id: "msg_1", role: "assistant" } },
      })
    })

    expect(seen.length).toBe(1)
    const payload = (seen[0] as SSEEvent).payload
    expect(payload.type).toBe("message.updated")
  })

  test("message.updated blocked when info.sessionID does not match", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "?sessionID=ses_target",
      () => {
        emitGlobalEvent({
          type: "message.updated",
          properties: { info: { sessionID: "ses_other", id: "msg_1" } },
        })
      },
      { collectCount: 1 },
    )

    expect(seen.length).toBe(0)
  })
})

describe("SSE filter with message.part.updated event shape", () => {
  test("message.part.updated passes when part.sessionID matches", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(app, "?sessionID=ses_target", () => {
      emitGlobalEvent({
        type: "message.part.updated",
        properties: { part: { sessionID: "ses_target", id: "part_1" } },
      })
    })

    expect(seen.length).toBe(1)
    const payload = (seen[0] as SSEEvent).payload
    expect(payload.type).toBe("message.part.updated")
  })

  test("message.part.updated blocked when part.sessionID does not match", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "?sessionID=ses_target",
      () => {
        emitGlobalEvent({
          type: "message.part.updated",
          properties: { part: { sessionID: "ses_other", id: "part_1" } },
        })
      },
      { collectCount: 1 },
    )

    expect(seen.length).toBe(0)
  })
})

describe("SSE filter mixed event stream", () => {
  test("filter correctly routes mixed events from multiple sessions", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "?sessionID=ses_mine",
      () => {
        // Should pass: matching session
        emitGlobalEvent({
          type: "session.status",
          properties: { sessionID: "ses_mine" },
        })
        // Should be blocked: different session
        emitGlobalEvent({
          type: "session.status",
          properties: { sessionID: "ses_other" },
        })
        // Should pass: server event always passes
        emitGlobalEvent({
          type: "server.heartbeat",
          properties: {},
        })
        // Should pass: no session affinity (config event)
        emitGlobalEvent({
          type: "config.updated",
          properties: { key: "value" },
        })
        // Should be blocked: different session via info.id
        emitGlobalEvent({
          type: "session.updated",
          properties: { info: { id: "ses_other" } },
        })
        // Should pass: matching session via info.id
        emitGlobalEvent({
          type: "session.updated",
          properties: { info: { id: "ses_mine" } },
        })
      },
      { collectCount: 4 },
    )

    expect(seen.length).toBe(4)
    const types = seen.map((e) => (e as SSEEvent).payload.type)
    expect(types).toContain("session.status")
    expect(types).toContain("server.heartbeat")
    expect(types).toContain("config.updated")
    expect(types).toContain("session.updated")
  })
})

describe("SSE without filter receives everything", () => {
  test("all events from all sessions pass through", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "",
      () => {
        emitGlobalEvent({
          type: "session.status",
          properties: { sessionID: "ses_one" },
        })
        emitGlobalEvent({
          type: "session.status",
          properties: { sessionID: "ses_two" },
        })
        emitGlobalEvent({
          type: "session.created",
          properties: { info: { id: "ses_three" } },
        })
      },
      { collectCount: 3 },
    )

    expect(seen.length).toBe(3)
  })
})
