import z from "zod"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { AsyncQueue } from "@/util/queue"
import { MAX_QUEUE_SIZE, WRITE_TIMEOUT_MS, writeSSEWithTimeout } from "@/util/sse"

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
              schema: resolver(
                z.union(BusEvent.payloads()).meta({
                  ref: "Event",
                }),
              ),
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
        const q = new AsyncQueue<string | null>()
        let done = false

        q.push(
          JSON.stringify({
            type: "server.connected",
            properties: {},
          }),
        )

        const enqueue = (payload: string) => {
          if (done) return
          // Guard against CLOSE_WAIT zombie sockets where `stream.onAbort` never
          // fires: if the consumer stops draining, the queue grows unbounded.
          if (q.size >= MAX_QUEUE_SIZE) {
            log.warn("event queue overflow, closing stream", { size: q.size })
            stop()
            return
          }
          q.push(payload)
        }

        // Send heartbeat every 10s to prevent stalled proxy streams.
        const heartbeat = setInterval(() => {
          enqueue(
            JSON.stringify({
              type: "server.heartbeat",
              properties: {},
            }),
          )
        }, 10_000)

        const stop = () => {
          if (done) return
          done = true
          clearInterval(heartbeat)
          unsub()
          q.close(null)
          log.info("event disconnected")
        }

        const unsub = Bus.subscribeAll((event) => {
          enqueue(JSON.stringify(event))
          if (event.type === Bus.InstanceDisposed.type) {
            stop()
          }
        })

        stream.onAbort(stop)

        try {
          for await (const data of q) {
            if (data === null) return
            await writeSSEWithTimeout(stream, data, WRITE_TIMEOUT_MS).catch((err) => {
              log.info("event write failed, closing stream", { error: String(err) })
              stop()
            })
          }
        } finally {
          stop()
        }
      })
    },
  )
