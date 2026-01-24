import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Global } from "@/global"

const log = Log.create({ service: "server" })

const BrowseNode = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "directory"]),
  })
  .meta({ ref: "BrowseNode" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the OpenCode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the OpenCode system using server-sent events.",
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
                      payload: BusEvent.payloads(),
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
              payload: {
                type: "server.connected",
                properties: {},
              },
            }),
          })
          async function handler(event: any) {
            await stream.writeSSE({
              data: JSON.stringify(event),
            })
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({
                payload: {
                  type: "server.heartbeat",
                  properties: {},
                },
              }),
            })
          }, 30000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .get(
      "/browse",
      describeRoute({
        summary: "Browse directory",
        description:
          "Browse any directory on the filesystem. Returns files and directories sorted with directories first.",
        operationId: "global.browse",
        responses: {
          200: {
            description: "Directory contents",
            content: {
              "application/json": {
                schema: resolver(BrowseNode.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string().optional(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path || Global.Path.home
        try {
          const entries = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: path, onlyFiles: false }))
          const items = await Promise.all(
            entries.map(async (name) => {
              const fullPath = path === "/" ? "/" + name : path + "/" + name
              const file = Bun.file(fullPath)
              const stat = await file.stat().catch(() => null)
              const isDir = stat ? stat.isDirectory() : false
              return { name, path: fullPath, type: isDir ? "directory" : "file" } as const
            }),
          )
          const sorted = items
            .filter((i) => !i.name.startsWith("."))
            .sort((a, b) => {
              if (a.type === "directory" && b.type !== "directory") return -1
              if (a.type !== "directory" && b.type === "directory") return 1
              return a.name.localeCompare(b.name)
            })
          return c.json(sorted)
        } catch {
          return c.json([], 200)
        }
      },
    ),
)
