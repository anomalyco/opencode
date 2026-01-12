import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Global } from "../global"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { Installation } from "@/installation"
import { MDNS } from "./mdns"
import { Provider } from "../provider/provider"
import { MCP } from "../mcp"

import { SessionRoute } from "./session"
import { PtyRoute } from "./pty"
import { ProviderRoute } from "./provider"
import { McpRoute } from "./mcp"
import { FileRoute, FindRoute } from "./file"
import { ConfigRoute } from "./config"
import { ToolRoute } from "./tool"
import { PermissionRoute } from "./permission"
import { AuthRoute } from "./auth"
import { WorktreeRoute } from "./worktree"
import { AgentRoute } from "./agent"
import { LspRoute } from "./lsp"
import { FormatterRoute } from "./formatter"
import { TuiRoute } from "./tui"
import { ProjectRoute } from "./project"
import { QuestionRoute } from "./question"
import { CommandRoute } from "./command"
import { errors } from "./error"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  export const Event = {
    Connected: BusEvent.define("server.connected", z.object({})),
    Disposed: BusEvent.define("global.disposed", z.object({})),
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof Storage.NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
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
        .use(
          cors({
            origin(input) {
              if (!input) return

              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (input === "tauri://localhost" || input === "http://tauri.localhost") return input

              // *.opencode.ai (https only, adjust if needed)
              if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .get(
          "/global/health",
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
          "/global/event",
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
          "/global/dispose",
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
                type: Event.Disposed.type,
                properties: {},
              },
            })
            return c.json(true)
          },
        )
        .use(async (c, next) => {
          let directory = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
          try {
            directory = decodeURIComponent(directory)
          } catch {
            // fallback to original value
          }
          return Instance.provide({
            directory,
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
        .use(validator("query", z.object({ directory: z.string().optional() })))

        .route("/project", ProjectRoute)
        .route("/pty", PtyRoute)
        .route("/config", ConfigRoute)
        .route("/experimental/tool", ToolRoute)
        .route("/experimental/worktree", WorktreeRoute)
        .route("/session", SessionRoute)
        .route("/permission", PermissionRoute)
        .route("/question", QuestionRoute)
        .route("/provider", ProviderRoute)
        .route("/find", FindRoute)
        .route("/file", FileRoute)
        .route("/agent", AgentRoute)
        .route("/mcp", McpRoute)
        .route("/lsp", LspRoute)
        .route("/formatter", FormatterRoute)
        .route("/tui", TuiRoute)
        .route("/auth", AuthRoute)
        .route("/command", CommandRoute)

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
          "/path",
          describeRoute({
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
            operationId: "path.get",
            responses: {
              200: {
                description: "Path",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .object({
                          home: z.string(),
                          state: z.string(),
                          config: z.string(),
                          worktree: z.string(),
                          directory: z.string(),
                        })
                        .meta({
                          ref: "Path",
                        }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json({
              home: Global.Path.home,
              state: Global.Path.state,
              config: Global.Path.config,
              worktree: Instance.worktree,
              directory: Instance.directory,
            })
          },
        )
        .get(
          "/vcs",
          describeRoute({
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
            operationId: "vcs.get",
            responses: {
              200: {
                description: "VCS info",
                content: {
                  "application/json": {
                    schema: resolver(Vcs.Info),
                  },
                },
              },
            },
          }),
          async (c) => {
            const branch = await Vcs.branch()
            return c.json({
              branch,
            })
          },
        )
        .get(
          "/experimental/resource",
          describeRoute({
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
            operationId: "experimental.resource.list",
            responses: {
              200: {
                description: "MCP resources",
                content: {
                  "application/json": {
                    schema: resolver(z.record(z.string(), MCP.Resource)),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await MCP.resources())
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
                if (event.type === Bus.InstanceDisposed.type) {
                  stream.close()
                }
              })

              // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "server.heartbeat",
                    properties: {},
                  }),
                })
              }, 30000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        .all("/*", async (c) => {
          const path = c.req.path
          const response = await proxy(`https://app.opencode.ai${path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
          response.headers.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
          )
          return response
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
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

  export function listen(opts: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
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

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, `opencode-${server.port!}`)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
