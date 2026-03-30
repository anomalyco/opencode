import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Log } from "@/util/log"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  service: z.string().optional(),
  level: Log.Level.optional(),
  sessionID: z.string().optional(),
})

const WriteBody = z.object({
  service: z.string().meta({ description: "Service name for the log entry" }),
  level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
  message: z.string().meta({ description: "Log message" }),
  extra: z.record(z.string(), z.any()).optional().meta({ description: "Additional metadata for the log entry" }),
})

export const LogRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List recent logs",
        description: "Get recent structured server logs, optionally filtered by service.",
        operationId: "log.list",
        responses: {
          200: {
            description: "Recent log entries",
            content: {
              "application/json": {
                schema: resolver(Log.Entry.array()),
              },
            },
          },
        },
      }),
      validator("query", ListQuery),
      async (c) => {
        const query = c.req.valid("query")
        return c.json(
          Log.list({
            limit: query.limit,
            service: query.service,
            level: query.level,
            sessionID: query.sessionID,
          }),
        )
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "app.log",
        responses: {
          200: {
            description: "Log entry written successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", WriteBody),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        const logger = Log.create({ service })

        switch (level) {
          case "debug":
            logger.debug(message, extra)
            break
          case "info":
            logger.info(message, extra)
            break
          case "error":
            logger.error(message, extra)
            break
          case "warn":
            logger.warn(message, extra)
            break
        }

        return c.json(true)
      },
    )
    .get(
      "/connect",
      describeRoute({
        summary: "Stream live logs",
        description: "Connect to a WebSocket feed of structured server logs in real time.",
        operationId: "log.connect",
        responses: {
          200: {
            description: "Connected to the live log stream",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("query", ListQuery),
      upgradeWebSocket((c) => {
        const query = ListQuery.parse({
          limit: c.req.query("limit"),
          service: c.req.query("service"),
          level: c.req.query("level"),
          sessionID: c.req.query("sessionID"),
        })
        let unsubscribe: VoidFunction | undefined

        return {
          onOpen(_event, ws) {
            unsubscribe = Log.subscribe((entry) => {
              if (!Log.matches(entry, query)) return
              try {
                ws.send(JSON.stringify(entry))
              } catch {}
            })
          },
          onClose() {
            unsubscribe?.()
            unsubscribe = undefined
          },
          onError() {
            unsubscribe?.()
            unsubscribe = undefined
          },
        }
      }),
    ),
)
