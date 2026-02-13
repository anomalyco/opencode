/**
 * Global routes: /global/health, /global/event, /global/dispose
 */
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { lazy } from "../lib/lazy.ts"
import { broadcastGlobal, addEventSink, removeEventSink, type GlobalBusEvent } from "../events/index.ts"
import type { GatewayContext } from "../context.ts"

export const GlobalRoutes = lazy(() =>
  new Hono<GatewayContext>()
    .get("/health", (c) => {
      return c.json({ healthy: true, version: "claxedo-gateway" })
    })
    .get("/config", (c) => {
      return c.json({
        version: "claxedo-gateway",
        server: "claxedo",
        status: "healthy",
      })
    })
    .post("/dispose", async (c) => {
      // Mimic OpenCode: dispose triggers a global.disposed event so clients refresh caches
      void broadcastGlobal({
        payload: { type: "global.disposed", properties: {} },
      })
      return c.json(true)
    })
    .get("/event", (c) => {
      return streamSSE(c, async (stream) => {
        const send = async (event: GlobalBusEvent) => {
          await stream.writeSSE({ data: JSON.stringify(event) })
        }

        addEventSink(send)

        // Initial "connected" event (matches OpenCode behavior)
        await send({ payload: { type: "server.connected", properties: {} } })

        // Heartbeat to keep SSE alive (matches OpenCode's 30s heartbeat)
        const heartbeat = setInterval(() => {
          send({ payload: { type: "server.heartbeat", properties: {} } }).catch(() => {})
        }, 30_000)

        stream.onAbort(() => {
          clearInterval(heartbeat)
          removeEventSink(send)
        })

        await new Promise<void>((resolve) => stream.onAbort(resolve))
      })
    }),
)
