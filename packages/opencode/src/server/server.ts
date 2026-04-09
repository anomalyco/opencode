import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { compress } from "hono/compress"
import { createNodeWebSocket } from "@hono/node-ws"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import type { UpgradeWebSocket } from "hono/ws"
import z from "zod"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { ProviderID } from "../provider/schema"
import { WorkspaceRouterMiddleware } from "./router"
import { errors } from "./error"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { errorHandler } from "./middleware"
import { InstanceRoutes } from "./instance"
import { initProjectors } from "./projectors"
import { createAdaptorServer, type ServerType } from "@hono/node-server"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

export namespace Server {
  export type Listener = {
    hostname: string
    port: number
    url: URL
    stop: (close?: boolean) => Promise<void>
  }

  const log = Log.create({ service: "server" })
  const zipped = compress()

  const skipCompress = (path: string, method: string) => {
    if (path === "/event" || path === "/global/event" || path === "/global/sync-event") return true
    if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return true
    return false
  }

  export const Default = lazy(() => create({}))

  export function ControlPlaneRoutes(upgrade: UpgradeWebSocket, app = new Hono(), opts?: { cors?: string[] }): Hono {
    return app
      .onError(errorHandler(log))
      .use((c, next) => {
        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return next()
        const password = Flag.OPENCODE_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

        if (c.req.query("auth_token")) c.req.raw.headers.set("authorization", `Basic ${c.req.query("auth_token")}`)

        return basicAuth({ username, password })(c, next)
      })
      .use(async (c, next) => {
        const skip = c.req.path === "/log"
        if (!skip) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        if (!skip) timer.stop()
      })
      .use(
        cors({
          maxAge: 86_400,
          origin(input) {
            if (!input) return

            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input

            if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) return input
            if (opts?.cors?.includes(input)) return input
          },
        }),
      )
      .use((c, next) => {
        if (skipCompress(c.req.path, c.req.method)) return next()
        return zipped(c, next)
      })
      .route("/global", GlobalRoutes())
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        validator("json", Auth.Info.zod),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          const info = c.req.valid("json")
          await Auth.set(providerID, info)
          return c.json(true)
        },
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          return c.json(true)
        },
      )
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "opencode",
              version: "0.0.3",
              description: "opencode api",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
            workspace: z.string().optional(),
          }),
        ),
      )
      .post(
        "/log",
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
        validator(
          "json",
          z.object({
            service: z.string().meta({ description: "Service name for the log entry" }),
            level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
            message: z.string().meta({ description: "Log message" }),
            extra: z
              .record(z.string(), z.any())
              .optional()
              .meta({ description: "Additional metadata for the log entry" }),
          }),
        ),
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
      .use(WorkspaceRouterMiddleware(upgrade))
  }

  function create(opts: { cors?: string[] }) {
    const app = new Hono()
    const ws = createNodeWebSocket({ app })
    return {
      app: ControlPlaneRoutes(ws.upgradeWebSocket, app, opts),
      ws,
    }
  }

  export function createApp(opts: { cors?: string[] }) {
    return create(opts).app
  }

  export async function openapi() {
    // Build a fresh app with all routes registered directly so
    // hono-openapi can see describeRoute metadata (`.route()` wraps
    // handlers when the sub-app has a custom errorHandler, which
    // strips the metadata symbol).
    const { app, ws } = create({})
    InstanceRoutes(ws.upgradeWebSocket, app)
    const result = await generateSpecs(app, {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export let url: URL

  export async function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }): Promise<Listener> {
    const built = create(opts)
    const start = (port: number) =>
      new Promise<ServerType>((resolve, reject) => {
        const server = createAdaptorServer({ fetch: built.app.fetch })
        built.ws.injectWebSocket(server)
        const fail = (err: Error) => {
          cleanup()
          reject(err)
        }
        const ready = () => {
          cleanup()
          resolve(server)
        }
        const cleanup = () => {
          server.off("error", fail)
          server.off("listening", ready)
        }
        server.once("error", fail)
        server.once("listening", ready)
        server.listen(port, opts.hostname)
      })

    const server = opts.port === 0 ? await start(4096).catch(() => start(0)) : await start(opts.port)
    const addr = server.address()
    if (!addr || typeof addr === "string") {
      throw new Error(`Failed to resolve server address for port ${opts.port}`)
    }

    const next = new URL("http://localhost")
    next.hostname = opts.hostname
    next.port = String(addr.port)
    url = next

    const mdns =
      opts.mdns &&
      addr.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (mdns) {
      MDNS.publish(addr.port, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    let closing: Promise<void> | undefined
    return {
      hostname: opts.hostname,
      port: addr.port,
      url: next,
      stop(close?: boolean) {
        closing ??= new Promise((resolve, reject) => {
          if (mdns) MDNS.unpublish()
          server.close((err) => {
            if (err) {
              reject(err)
              return
            }
            resolve()
          })
          if (close) {
            if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
              server.closeAllConnections()
            }
            if ("closeIdleConnections" in server && typeof server.closeIdleConnections === "function") {
              server.closeIdleConnections()
            }
          }
        })
        return closing
      },
    }
  }
}
