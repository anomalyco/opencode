import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { InstanceBootstrap } from "../project/bootstrap"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { normalizeBasePath } from "../cli/network"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []
  let _basePath = ""

  export function url(): URL {
    const baseUrl = _url ?? new URL("http://localhost:4096")
    if (!_basePath) return baseUrl
    const result = new URL(baseUrl.toString())
    result.pathname = _basePath
    return result
  }

  export const Event = {
    Connected: BusEvent.define("server.connected", z.object({})),
    Disposed: BusEvent.define("global.disposed", z.object({})),
  }

  export const App = (basePath = ""): Hono => buildApp(normalizeBasePath(basePath))

  function buildApp(basePath: string) {
    const root = new Hono()
    const app = basePath ? root.basePath(basePath) : root
    const router = app as Hono
    return (
      // TODO: Break server.ts into smaller route files to fix type inference
      router
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
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use((c, next) => {
          const password = Flag.OPENCODE_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
          return basicAuth({ username, password })(c, next)
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
        .route("/global", GlobalRoutes())
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
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/", FileRoutes())
        .route("/mcp", McpRoutes())
        .route("/tui", TuiRoutes())
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
          "/skill",
          describeRoute({
            summary: "List skills",
            description: "Get a list of all available skills in the OpenCode system.",
            operationId: "app.skills",
            responses: {
              200: {
                description: "List of skills",
                content: {
                  "application/json": {
                    schema: resolver(Skill.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const skills = await Skill.all()
            return c.json(skills)
          },
        )
        .get(
          "/lsp",
          describeRoute({
            summary: "Get LSP status",
            description: "Get LSP server status",
            operationId: "lsp.status",
            responses: {
              200: {
                description: "LSP server status",
                content: {
                  "application/json": {
                    schema: resolver(LSP.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await LSP.status())
          },
        )
        .get(
          "/formatter",
          describeRoute({
            summary: "Get formatter status",
            description: "Get formatter status",
            operationId: "formatter.status",
            responses: {
              200: {
                description: "Formatter status",
                content: {
                  "application/json": {
                    schema: resolver(Format.Status.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await Format.status())
          },
        )
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
          const rawPath = c.req.path
          const requestPath =
            basePath && (rawPath === basePath || rawPath.startsWith(basePath + "/"))
              ? rawPath.slice(basePath.length) || "/"
              : rawPath

          // Fallback to proxying from app.opencode.ai
          const response = await proxy(`https://app.opencode.ai${requestPath}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
          const contentType = response.headers.get("content-type") ?? ""
          const hasBody = response.status !== 204 && response.status !== 304
          if (basePath && hasBody && contentType.includes("text/html")) {
            let html = await response.text()
            const nonce = globalThis.crypto.randomUUID().replace(/-/g, "")
            const script = `<script nonce="${nonce}">window.__OPENCODE_BASE_PATH__=${JSON.stringify(basePath)};</script>`
            let modifiedHtml = html.replace(/<head([^>]*)>/i, `<head$1>${script}`)
            if (modifiedHtml === html) {
              modifiedHtml = `${script}${html}`
            }
            const headers = new Headers(response.headers)
            headers.set("Content-Security-Policy", buildCsp(nonce))
            return new Response(modifiedHtml, { status: response.status, headers })
          }
          if (basePath && hasBody && contentType.includes("javascript")) {
            const js = await response.text()
            const rewritten = js.replace(
              "S(B7,{root:",
              "S(B7,{base:window.__OPENCODE_BASE_PATH__||void 0,root:",
            )
            const headers = new Headers(response.headers)
            headers.set("Content-Security-Policy", buildCsp())
            return new Response(rewritten, { status: response.status, headers })
          }
          response.headers.set("Content-Security-Policy", buildCsp())
          return response
        }) as unknown as Hono
    )
  }

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App(_basePath) as Hono, {
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

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    cors?: string[]
    basePath?: string
  }) {
    _corsWhitelist = opts.cors ?? []
    _basePath = normalizeBasePath(opts.basePath)

    const app = App(_basePath)
    const fetch: Bun.ServeOptions["fetch"] = (req) => {
      if (!_basePath) return app.fetch(req)
      const url = new URL(req.url)
      if (!url.pathname.startsWith(_basePath)) {
        url.pathname = _basePath + (url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`)
        req = new Request(url, req)
      }
      return app.fetch(req)
    }
    const args: Omit<Bun.ServeOptions, "port"> = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch,
      websocket: websocket,
    }
    const tryServe = (port: number): Bun.Server | undefined => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server: Bun.Server | undefined =
      opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!)
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

  function buildCsp(nonce?: string) {
    const scriptSrc = nonce ? `'self' 'nonce-${nonce}'` : "'self'"
    return `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'`
  }

}
