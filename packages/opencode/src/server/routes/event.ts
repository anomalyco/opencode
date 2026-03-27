import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { AsyncQueue } from "../../util/queue"

const log = Log.create({ service: "server" })

export const EventRoutes = () =>
  new Hono().get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      description: "Get events",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(BusEvent.payloads()),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("event connected")
      c.header("Cache-Control", "no-cache, no-transform")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        const q = new AsyncQueue<string | null>(1000)
        let done = false
        let drop = 0
        let streak = 0
        let drain = Date.now()

        q.push(
          JSON.stringify({
            type: "server.connected",
            properties: {},
          }),
        )

        // Send heartbeat every 10s to prevent stalled proxy streams.
        const heartbeat = setInterval(() => {
          q.push(
            JSON.stringify({
              type: "server.heartbeat",
              properties: {},
            }),
          )
        }, 10_000)

        const watch = setInterval(() => {
          const delta = q.dropped - drop
          if (delta > 0) {
            log.warn("event queue dropped items", { dropped: q.dropped, size: q.size })
            streak += delta
            drop = q.dropped
          }
          if (delta === 0) {
            streak = 0
          }
          if (streak >= 100) {
            log.warn("disconnecting slow event client (drop threshold)", { dropped: q.dropped, size: q.size })
            stop()
            return
          }
          if (q.size > 0 && Date.now() - drain > 30_000) {
            log.warn("disconnecting slow event client (backlog timeout)", { dropped: q.dropped, size: q.size })
            stop()
          }
        }, 5_000)

        const stop = () => {
          if (done) return
          done = true
          clearInterval(heartbeat)
          clearInterval(watch)
          unsub()
          q.push(null)
          log.info("event disconnected")
        }

        const unsub = Bus.subscribeAll((event) => {
          q.push(JSON.stringify(event))
          if (event.type === Bus.InstanceDisposed.type) {
            stop()
          }
        })

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await stream.writeSSE({ data })
            drain = Date.now()
          }
        } finally {
          stop()
        }
      })
    },
  )
