import { afterEach, describe, expect, test } from "bun:test"
import { GlobalRoutes } from "../../src/server/routes/global"
import { GlobalBus } from "../../src/bus/global"
import { parseSSE } from "../../src/control-plane/sse"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

type SSEEvent = { directory?: string; payload: { type: string; properties: Record<string, unknown> } }

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

function emitGlobalEvent(payload: { type: string; properties: Record<string, unknown> }) {
  GlobalBus.emit("event", { directory: "test", payload })
}

async function collectSSE(
  app: ReturnType<typeof GlobalRoutes>,
  query: string,
  emitFn: () => void,
  opts?: { collectCount?: number },
) {
  const stop = new AbortController()
  const seen: unknown[] = []
  const collectCount = opts?.collectCount ?? 1

  try {
    const response = await app.request(`/event${query}`, { signal: stop.signal })
    expect(response.status).toBe(200)
    expect(response.body).toBeDefined()

    const done = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve() // resolve on timeout so we can check what we got
      }, 3000)

      let emitted = false
      void parseSSE(response.body!, stop.signal, (event) => {
        const e = event as { payload?: { type?: string } }
        // Skip the initial server.connected
        if (e.payload?.type === "server.connected") {
          if (!emitted) {
            emitted = true
            // Small delay to ensure the handler is fully registered
            setTimeout(emitFn, 50)
          }
          return
        }
        seen.push(e)
        if (seen.length >= collectCount) {
          clearTimeout(timeout)
          resolve()
        }
      }).catch(() => {
        // stream aborted
      })
    })

    await done
    return seen
  } finally {
    stop.abort()
  }
}

describe("global event SSE filtering", () => {
  test("SSE with sessionID filter passes matching events", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(app, "?sessionID=ses_target", () => {
      emitGlobalEvent({
        type: "session.status",
        properties: { sessionID: "ses_target" },
      })
    })

    expect(seen.length).toBe(1)
    const payload = (seen[0] as SSEEvent).payload
    expect(payload.type).toBe("session.status")
    expect(payload.properties.sessionID).toBe("ses_target")
  })

  test("SSE with sessionID filter blocks non-matching events", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "?sessionID=ses_target",
      () => {
        emitGlobalEvent({
          type: "session.status",
          properties: { sessionID: "ses_other" },
        })
      },
      { collectCount: 1 },
    )

    // Should timeout without receiving the non-matching event
    expect(seen.length).toBe(0)
  })

  test("SSE with filter always passes server.* events", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(app, "?sessionID=ses_target", () => {
      emitGlobalEvent({
        type: "server.heartbeat",
        properties: {},
      })
    })

    expect(seen.length).toBe(1)
    expect((seen[0] as SSEEvent).payload.type).toBe("server.heartbeat")
  })

  test("SSE with filter passes events with no session affinity", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(app, "?sessionID=ses_target", () => {
      emitGlobalEvent({
        type: "config.updated",
        properties: {},
      })
    })

    expect(seen.length).toBe(1)
    expect((seen[0] as SSEEvent).payload.type).toBe("config.updated")
  })

  test("SSE without filter passes all events", async () => {
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
      },
      { collectCount: 2 },
    )

    expect(seen.length).toBe(2)
  })
})
