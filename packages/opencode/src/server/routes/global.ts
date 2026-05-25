import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { GlobalBus } from "@/bus/global"
import { AsyncQueue } from "@/util/queue"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { Config } from "../../config/config"
import { errors } from "../error"

const log = Log.create({ service: "server" })

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

function diag(message: string) {
  process.stderr.write(`[tcc-diagnostic] [aether-flow] ${message}\n`)
}

type StreamItem = {
  data: string
  at: number
  atEpoch: number
  summary?: string
}

function summarizeToolFreezeEvent(raw: string) {
  try {
    const event = JSON.parse(raw) as {
      directory?: string
      payload?: {
        type?: string
        properties?: {
          sessionID?: string
          id?: string
          requestID?: string
          questions?: unknown[]
          part?: {
            id?: string
            messageID?: string
            sessionID?: string
            type?: string
            tool?: string
            state?: { status?: string }
          }
        }
      }
    }
    const payload = event.payload
    if (!payload?.type) return
    const directory = event.directory ?? "global"
    if (payload.type === "session.status") {
      const props = payload.properties
      return `type=${payload.type} dir=${directory} session=${props?.sessionID ?? "none"} status=${(props as { status?: { type?: string } } | undefined)?.status?.type ?? "none"}`
    }
    if (payload.type === "question.asked" || payload.type === "question.replied" || payload.type === "question.rejected") {
      const props = payload.properties
      return `type=${payload.type} dir=${directory} session=${props?.sessionID ?? "none"} request=${props?.id ?? props?.requestID ?? "none"} questions=${props?.questions?.length ?? "none"}`
    }
    if (payload.type !== "message.part.updated") return
    const part = payload.properties?.part
    if (part?.type !== "tool") return
    if (part.tool === "hook") return
    return `type=${payload.type} dir=${directory} session=${part.sessionID ?? "none"} message=${part.messageID ?? "none"} part=${part.id ?? "none"} tool=${part.tool ?? "none"} status=${part.state?.status ?? "none"}`
  } catch {
    return
  }
}

function streamItem(data: string): StreamItem {
  return {
    data,
    at: performance.now(),
    atEpoch: Date.now(),
    summary: summarizeToolFreezeEvent(data),
  }
}

function dataWithToolFreezeMeta(item: StreamItem, writeStart: number) {
  if (!item.summary) return item.data
  try {
    const event = JSON.parse(item.data) as Record<string, unknown>
    event.toolFreeze = {
      serverCreatedAt: item.atEpoch,
      serverWriteStartAt: Date.now(),
      serverQueuedMs: Math.round(writeStart - item.at),
      summary: item.summary,
    }
    return JSON.stringify(event)
  } catch {
    return item.data
  }
}

async function streamEvents(c: Context, subscribe: (q: AsyncQueue<StreamItem | null>) => () => void) {
  return streamSSE(c, async (stream) => {
    const q = new AsyncQueue<StreamItem | null>()
    let done = false

    q.push(
      streamItem(JSON.stringify({
        payload: {
          type: "server.connected",
          properties: {},
        },
      })),
    )

    // Send heartbeat every 10s to prevent stalled proxy streams.
    const heartbeat = setInterval(() => {
      q.push(
        streamItem(JSON.stringify({
          payload: {
            type: "server.heartbeat",
            properties: {},
          },
        })),
      )
    }, 10_000)

    const stop = () => {
      if (done) return
      done = true
      clearInterval(heartbeat)
      unsub()
      q.push(null)
      log.info("global event disconnected")
    }

    const unsub = subscribe(q)

    stream.onAbort(stop)

    try {
      for await (const item of q) {
        if (item === null) return
        const start = performance.now()
        if (item.summary) {
          log.info("tool-freeze sse write start", {
            queued: Math.round(start - item.at),
            summary: item.summary,
          })
          diag(`stage=sse-write-start queued=${Math.round(start - item.at)} summary="${item.summary}"`)
        }
        await stream.writeSSE({ data: dataWithToolFreezeMeta(item, start) })
        if (item.summary) {
          log.info("tool-freeze sse write end", {
            queued: Math.round(start - item.at),
            took: Math.round(performance.now() - start),
            summary: item.summary,
          })
          diag(
            `stage=sse-write-end queued=${Math.round(start - item.at)} took=${Math.round(performance.now() - start)} summary="${item.summary}"`,
          )
        }
      }
    } finally {
      stop()
    }
  })
}

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
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")

        return streamEvents(c, (q) => {
          async function handler(event: any) {
            q.push(streamItem(JSON.stringify(event)))
          }
          GlobalBus.on("event", handler)
          return () => GlobalBus.off("event", handler)
        })
      },
    )
    .get(
      "/sync-event",
      describeRoute({
        summary: "Subscribe to global sync events",
        description: "Get global sync events",
        operationId: "global.sync-event.subscribe",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      payload: SyncEvent.payloads(),
                    })
                    .meta({
                      ref: "SyncEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global sync event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamEvents(c, (q) => {
          return SyncEvent.subscribeAll(({ def, event }) => {
            // TODO: don't pass def, just pass the type (and it should
            // be versioned)
            q.push(
              streamItem(JSON.stringify({
                payload: {
                  ...event,
                  type: SyncEvent.versionedType(def.type, def.version),
                },
              })),
            )
          })
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global OpenCode configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global OpenCode configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const next = await Config.updateGlobal(config)
        return c.json(next)
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
    .post(
      "/upgrade",
      describeRoute({
        summary: "Upgrade opencode",
        description: "Upgrade opencode to the specified version or latest if not specified.",
        operationId: "global.upgrade",
        responses: {
          200: {
            description: "Upgrade result",
            content: {
              "application/json": {
                schema: resolver(
                  z.union([
                    z.object({
                      success: z.literal(true),
                      version: z.string(),
                    }),
                    z.object({
                      success: z.literal(false),
                      error: z.string(),
                    }),
                  ]),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          target: z.string().optional(),
        }),
      ),
      async (c) => {
        const method = await Installation.method()
        if (method === "unknown") {
          return c.json({ success: false, error: "Unknown installation method" }, 400)
        }
        const target = c.req.valid("json").target || (await Installation.latest(method))
        const result = await Installation.upgrade(method, target)
          .then(() => ({ success: true as const, version: target }))
          .catch((e) => ({ success: false as const, error: e instanceof Error ? e.message : String(e) }))
        if (result.success) {
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Installation.Event.Updated.type,
              properties: { version: target },
            },
          })
          return c.json(result)
        }
        return c.json(result, 500)
      },
    ),
)
