import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { streamSSE } from "hono/streaming"
import { Bus } from "../../bus"
import { GlobalBus } from "@/bus/global"
import { Log } from "../../util/log"

export function eventRoutes() {
  const log = Log.create({ service: "server" })
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "Get events",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(Bus.payloads()),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("event connected")
      return streamSSE(c, async (stream) => {
        stream.writeSSE({
          data: JSON.stringify({
            type: "server.connected",
            properties: {},
          }),
        })
        const unsub = Bus.subscribeAll(async (event) => {
          await stream.writeSSE({
            data: JSON.stringify(event),
          })
        })
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            unsub()
            resolve()
            log.info("event disconnected")
          })
        })
      })
    },
  )

  return router
}

export function globalEventRoutes() {
  const log = Log.create({ service: "server" })
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "Get events",
      operationId: "global.event",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z
                  .object({
                    directory: z.string(),
                    payload: Bus.payloads(),
                  })
                  .meta({
                    ref: "GlobalEvent",
                  }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("global event connected")
      return streamSSE(c, async (stream) => {
        stream.writeSSE({
          data: JSON.stringify({
            type: "server.connected",
            properties: {},
          }),
        })
        async function handler(event: any) {
          await stream.writeSSE({
            data: JSON.stringify(event),
          })
        }
        GlobalBus.on("event", handler)
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            GlobalBus.off("event", handler)
            resolve()
            log.info("global event disconnected")
          })
        })
      })
    },
  )

  return router
}
