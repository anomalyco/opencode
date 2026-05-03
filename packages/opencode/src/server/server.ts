import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { getCookie, setCookie } from "hono/cookie"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { Instance } from "../project/instance"

import { Agent } from "../agent/agent"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { McpRoutes } from "./routes/mcp"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db.pg"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { Filesystem } from "@/util/filesystem"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { lazy } from "@/util/lazy"
import { initVeritlyTracer, veritlyHonoOtelMiddleware } from "@veritly/telemetry-veritly"
import path from "path"
import { apiHealthReportSimple, isPublicHealthPath } from "./health"
import { AuthRoutes, getCookieOptions, type SessionUser } from "./routes/auth"
import { isOpencodeWorkosEnabled } from "./workos-env"
import { resolveInstanceProject } from "./resolve-instance-project"
import {
  createWorkOSClient,
  requireCookiePassword,
  validateWorkosSession,
  WORKOS_SESSION_COOKIE_NAME,
} from "@veritly/auth-shared"

// This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initVeritlyTracer({
  serviceName: "veritly-opencode",
  // OpenTelemetry's context.with must use AsyncLocalStorage in Node/Bun so it nests correctly with
  // Instance (AsyncLocalStorage from util/context) across await boundaries in route handlers.
  useAsyncLocalStorage: true,
})

export namespace Server {
  const log = Log.create({ service: "server" })

  function localAppDistDir() {
    const dir = process.env.OPENCODE_APP_DIST_DIR?.trim()
    return dir ? Filesystem.resolve(dir) : undefined
  }

  async function serveLocalApp(pathname: string) {
    const root = localAppDistDir()
    if (!root) return

    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
    const candidate = Filesystem.resolve(path.join(root, relativePath))
    const indexFile = Filesystem.resolve(path.join(root, "index.html"))

    if (!candidate.startsWith(root)) return new Response("Not found", { status: 404 })

    const target = (await Filesystem.exists(candidate)) ? candidate : indexFile
    if (!(await Filesystem.exists(target))) return

    const file = Bun.file(target)
    return new Response(file, {
      headers: {
        "Content-Type": Filesystem.mimeType(target),
        "Cache-Control": target === indexFile ? "no-cache" : "public, max-age=31536000, immutable",
      },
    })
  }

  export const Default = lazy(() => createApp({}))

  export const createApp = (opts: { cors?: string[] }): Hono => {
    const app = new Hono()
    return app
      .use("*", veritlyHonoOtelMiddleware("veritly-opencode"))
      .onError((err, c) => {
        log.error("failed", {
          error: err,
        })
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
          else if (err.name.startsWith("Worktree")) status = 400
          else status = 500
          return c.json(err.toObject(), { status })
        }
        if (err instanceof HTTPException) return err.getResponse()
        const message = err instanceof Error && err.stack ? err.stack : err.toString()
        return c.json(new NamedError.Unknown({ message }).toObject(), {
          status: 500,
        })
      })
      .use(
        cors({
          credentials: true,
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
            if (/^https:\/\/([a-z0-9-]+\.)*veritly\.co\.uk$/.test(input)) return input
            if (opts?.cors?.includes(input)) return input
            return
          },
        }),
      )
      .get("/livez", (c) => c.text("ok"))
      .get("/readyz", async (c) => {
        const report = await apiHealthReportSimple()
        return c.json(report, report.ok ? 200 : 503)
      })
      .get("/debug", (c) => c.text("debug ok"))
      .use(async (c, next) => {
        if (c.req.method === "OPTIONS") return next()
        if (isPublicHealthPath(c.req.path)) return next()
        if (
          c.req.path.startsWith("/auth/login") ||
          c.req.path.startsWith("/auth/callback") ||
          c.req.path.startsWith("/auth/logout") ||
          c.req.path.startsWith("/auth/session")
        )
          return next()

        const workosConfigured = isOpencodeWorkosEnabled()
        if (!workosConfigured) {
          const password = Flag.OPENCODE_SERVER_PASSWORD
          if (!password) return next()
          return next()
        }
        if (process.env["OPENCODE_E2E_USER_ID"]) return next()

        const sessionData = getCookie(c, WORKOS_SESSION_COOKIE_NAME)
        if (!sessionData) {
          return c.json({ error: "Unauthorized" }, 401)
        }

        try {
          const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
          const apiKey = process.env["WORKOS_API_KEY"]
          const clientId = process.env["WORKOS_CLIENT_ID"]

          if (!apiKey || !clientId) {
            return c.json({ error: "WorkOS not configured" }, 500)
          }

          const workos = createWorkOSClient({ apiKey, clientId })
          const result = await validateWorkosSession({ workos, sessionData, cookiePassword })

          if (!result.ok) {
            return c.json({ error: "Invalid session" }, 401)
          }

          // If session was refreshed, update the cookie with new session data
          if (result.refreshedSessionData) {
            setCookie(c, WORKOS_SESSION_COOKIE_NAME, result.refreshedSessionData, getCookieOptions())
          }
        } catch {
          return c.json({ error: "Authentication failed" }, 401)
        }

        return next()
      })
      .use(async (c, next) => {
        const skipLogging = c.req.path === "/log"
        if (!skipLogging) {
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
        if (!skipLogging) {
          timer.stop()
        }
      })
      .route("/global", GlobalRoutes())
      .route("/auth", AuthRoutes)
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
            providerID: z.string(),
          }),
        ),
        validator("json", Auth.Info),
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
            providerID: z.string(),
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          return c.json(true)
        },
      )
      .use(async (c, next) => {
        if (c.req.path === "/log") return next()
        const resolved = await resolveInstanceProject(c)
        if (resolved instanceof Response) return resolved
        const project = resolved
        return Instance.provide({
          project,
          init: InstanceBootstrap,
          async fn() {
            return next()
          },
        })
      })
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
            project: z.string().optional(),
          }),
        ),
      )
      .route("/project", ProjectRoutes())
      .route("/config", ConfigRoutes())
      .route("/experimental", ExperimentalRoutes())
      .route("/session", SessionRoutes())
      .route("/permission", PermissionRoutes())
      .route("/question", QuestionRoutes())
      .route("/provider", ProviderRoutes())
      .route("/mcp", McpRoutes())
      .post(
        "/instance/dispose",
        describeRoute({
          summary: "Dispose instance",
          description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
          operationId: "instance.dispose",
          responses: {
            200: {
              description: "Instance disposed",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await Instance.dispose()
          return c.json(true)
        },
      )
      .get(
        "/command",
        describeRoute({
          summary: "List commands",
          description: "Get a list of all available commands in the OpenCode system.",
          operationId: "command.list",
          responses: {
            200: {
              description: "List of commands",
              content: {
                "application/json": {
                  schema: resolver(Command.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const commands = await Command.list()
          return c.json(commands)
        },
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
      .get(
        "/agent",
        describeRoute({
          summary: "List agents",
          description: "Get a list of all available AI agents in the OpenCode system.",
          operationId: "app.agents",
          responses: {
            200: {
              description: "List of agents",
              content: {
                "application/json": {
                  schema: resolver(Agent.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const modes = await Agent.list()
          return c.json(modes)
        },
      )
      .get(
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
          c.header("X-Accel-Buffering", "no")
          c.header("X-Content-Type-Options", "nosniff")
          return streamSSE(c, async (stream) => {
            await new Promise<void>((resolve) => {
              let done = false
              let heartbeat: ReturnType<typeof setInterval> | undefined

              const stop = (reason: string) => {
                if (done) return
                done = true
                if (heartbeat) clearInterval(heartbeat)
                unsub()
                c.req.raw.signal.removeEventListener("abort", abort)
                log.info("event disconnected", { reason })
                resolve()
              }

              const send = (event: unknown) =>
                stream
                  .writeSSE({
                    data: JSON.stringify(event),
                  })
                  .then(
                    () => true,
                    () => {
                      stop("write")
                      return false
                    },
                  )

              const unsub = Bus.subscribeAll((event) => {
                void send(event).then((ok) => {
                  if (!ok || event.type !== Bus.InstanceDisposed.type) return
                  stream.close()
                })
              })

              const abort = () => stop("abort")

              stream.onAbort(abort)
              c.req.raw.signal.addEventListener("abort", abort, { once: true })
              void send({
                type: "server.connected",
                properties: {},
              })

              heartbeat = setInterval(() => {
                void send({
                  type: "server.heartbeat",
                  properties: {},
                })
              }, 10_000)
            })
          })
        },
      )
      .all("/*", async (c) => {
        const path = c.req.path
        const local = await serveLocalApp(path)
        if (local) return local

        return c.json({ error: "Not found", path }, 404)
      })
  }

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(Default(), {
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

  /** @deprecated do not use this dumb shit */
  export let url: URL

  export function listen(opts: { port: number; hostname: string; cors?: string[] }) {
    url = new URL(`http://${opts.hostname}:${opts.port}`)
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    return server
  }
}
