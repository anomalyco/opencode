import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../config/config"
import { errors } from "./error"
import { EventStore } from "../event-store"
import { Global } from "../global"
import path from "path"

const app = new Hono()

/**
 * GET /stream/events - Durable stream endpoint
 *
 * Catch-up mode: Returns JSON array of events from offset onwards
 * Live mode: SSE stream with catch-up events followed by real-time subscription
 *
 * Protocol:
 * - offset="-1" means start from beginning
 * - Headers: Stream-Next-Offset (latest offset), Stream-Up-To-Date (boolean)
 * - SSE format: data: {event JSON}\n\n
 */
export const StreamRoute = app.get(
  "/stream/events",
  describeRoute({
    summary: "Stream session events",
    description:
      "Stream events for a session. Supports catch-up mode (JSON array) or live SSE streaming with catch-up + real-time events.",
    operationId: "stream.events",
    responses: {
      200: {
        description: "Event stream",
        content: {
          "application/json": {
            schema: resolver(
              z
                .array(
                  z.object({
                    offset: z.string(),
                    event: z.unknown(),
                  }),
                )
                .meta({ ref: "StreamEvents" }),
            ),
          },
          "text/event-stream": {
            schema: resolver(
              z
                .object({
                  offset: z.string(),
                  event: z.unknown(),
                })
                .meta({ ref: "StreamEvent" }),
            ),
          },
        },
      },
      ...errors(400),
    },
  }),
  validator(
    "query",
    z.object({
      sessionId: z.string().describe("Session identifier"),
      offset: z.string().default("-1").describe("Starting offset (-1 for stream start, or ULID)"),
      live: z
        .enum(["true", "false"])
        .optional()
        .transform((val) => val === "true")
        .describe("Enable live SSE streaming with real-time events"),
    }),
  ),
  async (c) => {
    const config = await Config.get()

    if (!config.experimental?.durableStreams) {
      return c.json(
        {
          error: "DurableStreamsDisabled",
          message: "Enable experimental.durableStreams in config to use this endpoint",
        },
        400,
      )
    }

    const { sessionId, offset, live } = c.req.valid("query")

    const dbPath = path.join(Global.Path.state, "events.db")
    const store = EventStore.create(dbPath)

    const events = store.query(sessionId, offset)
    const latestOffset = store.getLatestOffset(sessionId)
    const upToDate = events.length === 0 || (latestOffset && events[events.length - 1]?.offset === latestOffset)

    if (!live) {
      // Catch-up mode: JSON array
      c.header("Stream-Next-Offset", latestOffset ?? "-1")
      c.header("Stream-Up-To-Date", String(upToDate))
      store.close()
      return c.json(events)
    }

    // Live mode: SSE stream
    return streamSSE(c, async (stream) => {
      // 1. Send catch-up events
      for (const item of events) {
        await stream.writeSSE({
          data: JSON.stringify(item),
        })
      }

      // 2. Mark catch-up complete
      await stream.writeSSE({
        event: "catch-up-complete",
        data: JSON.stringify({
          offset: latestOffset ?? "-1",
          upToDate,
        }),
      })

      // 3. TODO: Subscribe to new events (requires EventBus integration)
      // For now, keep connection open with heartbeat
      const heartbeat = setInterval(() => {
        stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ timestamp: Date.now() }),
        })
      }, 30000)

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          store.close()
          resolve()
        })
      })
    })
  },
)
