import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { AsyncQueue } from "../../util/queue"
import { Database, and, asc, gt, lte, sql } from "@/storage/db"
import { EventTable } from "@/sync/event.sql"
import { EventID } from "@/sync/schema"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "server" })

function max() {
  return Flag.OPENCODE_EXPERIMENTAL_EVENT_QUEUE_MAX ?? 1000
}

function parse(input?: string) {
  if (!input) return
  const value = Number(input)
  if (!Number.isSafeInteger(value)) return
  if (value < 0) return
  return value
}

function replay(next: number) {
  return Database.use((db) => {
    const oldest =
      db
        .select({ seq: sql<number>`min(${EventTable.seq})` })
        .from(EventTable)
        .get()?.seq ?? 0
    const latest =
      db
        .select({ seq: sql<number>`max(${EventTable.seq})` })
        .from(EventTable)
        .get()?.seq ?? 0
    if (next < oldest) {
      return {
        rows: [] as Array<{ id: string; type: string; data: Record<string, unknown> }>,
        oldest,
        latest,
      }
    }

    const rows = db
      .select({
        id: EventTable.id,
        type: EventTable.type,
        data: EventTable.data,
      })
      .from(EventTable)
      .where(and(gt(EventTable.seq, next), lte(EventTable.seq, latest)))
      .orderBy(asc(EventTable.seq))
      .all()

    return {
      rows,
      oldest,
      latest,
    }
  })
}

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
      const raw = c.req.query("after_seq")
      const after = parse(raw ?? undefined)
      log.info("event connected")
      c.header("Cache-Control", "no-cache, no-transform")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      return streamSSE(c, async (stream) => {
        if (raw !== undefined) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "server.connected",
              properties: {},
            }),
          })

          if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES || after === undefined) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: BusEvent.StreamExpired.type,
                properties: {
                  next: after ?? -1,
                  oldest: 0,
                  latest: 0,
                },
              }),
            })
            return
          }

          const data = replay(after)
          if (after < data.oldest) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: BusEvent.StreamExpired.type,
                properties: {
                  next: after,
                  oldest: data.oldest,
                  latest: data.latest,
                },
              }),
            })
            return
          }

          for (const row of data.rows) {
            await stream.writeSSE({
              data: JSON.stringify({
                id: row.id,
                type: row.type,
                properties: row.data,
              }),
            })
          }
          return
        }

        const limit = max()
        const q = new AsyncQueue<string | null>({ max: limit })
        let done = false
        let dropped = 0
        let drain = Date.now()

        const watch = setInterval(() => {
          if (q.size() > 0 && Date.now() - drain > 30_000) {
            log.warn("disconnecting slow event client (backlog timeout)", { size: q.size() })
            stop()
          }
        }, 5_000)

        function push(data: string, input?: { force?: boolean }) {
          if (q.push(data, input)) return
          dropped++
          q.clear()
          q.push(
            JSON.stringify({
              type: BusEvent.StreamLagged.type,
              properties: {
                limit,
                queued: q.size(),
                dropped,
              },
            }),
            { force: true },
          )
          q.push(null, { force: true })
        }

        push(
          JSON.stringify({
            type: "server.connected",
            properties: {},
          }),
          { force: true },
        )

        // Send heartbeat every 10s to prevent stalled proxy streams.
        const heartbeat = setInterval(() => {
          push(
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
          clearInterval(watch)
          unsub()
          q.push(null, { force: true })
          log.info("event disconnected")
        }

        const unsub = Bus.subscribeAll((event) => {
          const id = EventID.ascending()
          push(
            JSON.stringify({
              id,
              ...event,
            }),
          )
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
