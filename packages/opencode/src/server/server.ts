import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { proxy } from "hono/proxy"
import { Session } from "../session"
import z from "zod"
import { Provider } from "../provider/provider"
import { filter, mapValues, sortBy, pipe } from "remeda"
import { NamedError } from "@opencode-ai/util/error"
import { ModelsDev } from "../provider/models"
import { Ripgrep } from "../file/ripgrep"
import { Config } from "../config/config"
import { File } from "../file"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoute } from "./tui"
import { SessionRoute } from "./session"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Auth } from "../auth"
import { Command } from "../command"
import { ProviderAuth } from "../provider/auth"
import { Global } from "../global"
import { ProjectRoute } from "./project"
import { ToolRegistry } from "../tool/registry"
import { zodToJsonSchema } from "zod-to-json-schema"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { MCP } from "../mcp"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { upgradeWebSocket, websocket } from "hono/bun"
import { errors } from "./error"
import { Pty } from "@/pty"
import { PermissionNext } from "@/permission/next"
import { QuestionRoute } from "./question"
import { Installation } from "@/installation"
import { MDNS } from "./mdns"
import { Worktree } from "../worktree"

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
  export const App = lazy(
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

        .get(
          "/pty",
          describeRoute({
            summary: "List PTY sessions",
            description: "Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.",
            operationId: "pty.list",
            responses: {
              200: {
                description: "List of sessions",
                content: {
                  "application/json": {
                    schema: resolver(Pty.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(Pty.list())
          },
        )
        .post(
          "/pty",
          describeRoute({
            summary: "Create PTY session",
            description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
            operationId: "pty.create",
            responses: {
              200: {
                description: "Created session",
                content: {
                  "application/json": {
                    schema: resolver(Pty.Info),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator("json", Pty.CreateInput),
          async (c) => {
            const info = await Pty.create(c.req.valid("json"))
            return c.json(info)
          },
        )
        .get(
          "/pty/:ptyID",
          describeRoute({
            summary: "Get PTY session",
            description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
            operationId: "pty.get",
            responses: {
              200: {
                description: "Session info",
                content: {
                  "application/json": {
                    schema: resolver(Pty.Info),
                  },
                },
              },
              ...errors(404),
            },
          }),
          validator("param", z.object({ ptyID: z.string() })),
          async (c) => {
            const info = Pty.get(c.req.valid("param").ptyID)
            if (!info) {
              throw new Storage.NotFoundError({ message: "Session not found" })
            }
            return c.json(info)
          },
        )
        .put(
          "/pty/:ptyID",
          describeRoute({
            summary: "Update PTY session",
            description: "Update properties of an existing pseudo-terminal (PTY) session.",
            operationId: "pty.update",
            responses: {
              200: {
                description: "Updated session",
                content: {
                  "application/json": {
                    schema: resolver(Pty.Info),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator("param", z.object({ ptyID: z.string() })),
          validator("json", Pty.UpdateInput),
          async (c) => {
            const info = await Pty.update(c.req.valid("param").ptyID, c.req.valid("json"))
            return c.json(info)
          },
        )
        .delete(
          "/pty/:ptyID",
          describeRoute({
            summary: "Remove PTY session",
            description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
            operationId: "pty.remove",
            responses: {
              200: {
                description: "Session removed",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(404),
            },
          }),
          validator("param", z.object({ ptyID: z.string() })),
          async (c) => {
            await Pty.remove(c.req.valid("param").ptyID)
            return c.json(true)
          },
        )
        .get(
          "/pty/:ptyID/connect",
          describeRoute({
            summary: "Connect to PTY session",
            description:
              "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
            operationId: "pty.connect",
            responses: {
              200: {
                description: "Connected session",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(404),
            },
          }),
          validator("param", z.object({ ptyID: z.string() })),
          upgradeWebSocket((c) => {
            const id = c.req.param("ptyID")
            let handler: ReturnType<typeof Pty.connect>
            if (!Pty.get(id)) throw new Error("Session not found")
            return {
              onOpen(_event, ws) {
                handler = Pty.connect(id, ws)
              },
              onMessage(event) {
                handler?.onMessage(String(event.data))
              },
              onClose() {
                handler?.onClose()
              },
            }
          }),
        )

        .get(
          "/config",
          describeRoute({
            summary: "Get configuration",
            description: "Retrieve the current OpenCode configuration settings and preferences.",
            operationId: "config.get",
            responses: {
              200: {
                description: "Get config info",
                content: {
                  "application/json": {
                    schema: resolver(Config.Info),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await Config.get())
          },
        )

        .patch(
          "/config",
          describeRoute({
            summary: "Update configuration",
            description: "Update OpenCode configuration settings and preferences.",
            operationId: "config.update",
            responses: {
              200: {
                description: "Successfully updated config",
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
            await Config.update(config)
            return c.json(config)
          },
        )
        .get(
          "/experimental/tool/ids",
          describeRoute({
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
            operationId: "tool.ids",
            responses: {
              200: {
                description: "Tool IDs",
                content: {
                  "application/json": {
                    schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
                  },
                },
              },
              ...errors(400),
            },
          }),
          async (c) => {
            return c.json(await ToolRegistry.ids())
          },
        )
        .get(
          "/experimental/tool",
          describeRoute({
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
            operationId: "tool.list",
            responses: {
              200: {
                description: "Tools",
                content: {
                  "application/json": {
                    schema: resolver(
                      z
                        .array(
                          z
                            .object({
                              id: z.string(),
                              description: z.string(),
                              parameters: z.any(),
                            })
                            .meta({ ref: "ToolListItem" }),
                        )
                        .meta({ ref: "ToolList" }),
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
              provider: z.string(),
              model: z.string(),
            }),
          ),
          async (c) => {
            const { provider } = c.req.valid("query")
            const tools = await ToolRegistry.tools(provider)
            return c.json(
              tools.map((t) => ({
                id: t.id,
                description: t.description,
                // Handle both Zod schemas and plain JSON schemas
                parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
              })),
            )
          },
        )
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
        .post(
          "/experimental/worktree",
          describeRoute({
            summary: "Create worktree",
            description: "Create a new git worktree for the current project.",
            operationId: "worktree.create",
            responses: {
              200: {
                description: "Worktree created",
                content: {
                  "application/json": {
                    schema: resolver(Worktree.Info),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator("json", Worktree.create.schema),
          async (c) => {
            const body = c.req.valid("json")
            const worktree = await Worktree.create(body)
            return c.json(worktree)
          },
        )
        .get(
          "/experimental/worktree",
          describeRoute({
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
            operationId: "worktree.list",
            responses: {
              200: {
                description: "List of worktree directories",
                content: {
                  "application/json": {
                    schema: resolver(z.array(z.string())),
                  },
                },
              },
            },
          }),
          async (c) => {
            const sandboxes = await Project.sandboxes(Instance.project.id)
            return c.json(sandboxes)
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
        .route("/session", SessionRoute)

        .post(
          "/permission/:requestID/reply",
          describeRoute({
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
            operationId: "permission.reply",
            responses: {
              200: {
                description: "Permission processed successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              requestID: z.string(),
            }),
          ),
          validator("json", z.object({ reply: PermissionNext.Reply, message: z.string().optional() })),
          async (c) => {
            const params = c.req.valid("param")
            const json = c.req.valid("json")
            await PermissionNext.reply({
              requestID: params.requestID,
              reply: json.reply,
              message: json.message,
            })
            return c.json(true)
          },
        )
        .get(
          "/permission",
          describeRoute({
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
            operationId: "permission.list",
            responses: {
              200: {
                description: "List of pending permissions",
                content: {
                  "application/json": {
                    schema: resolver(PermissionNext.Request.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const permissions = await PermissionNext.list()
            return c.json(permissions)
          },
        )
        .route("/question", QuestionRoute)
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
        .get(
          "/config/providers",
          describeRoute({
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
            operationId: "config.providers",
            responses: {
              200: {
                description: "List of providers",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        providers: Provider.Info.array(),
                        default: z.record(z.string(), z.string()),
                      }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            using _ = log.time("providers")
            const providers = await Provider.list().then((x) => mapValues(x, (item) => item))
            return c.json({
              providers: Object.values(providers),
              default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
            })
          },
        )
        .get(
          "/provider",
          describeRoute({
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
            operationId: "provider.list",
            responses: {
              200: {
                description: "List of providers",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        all: ModelsDev.Provider.array(),
                        default: z.record(z.string(), z.string()),
                        connected: z.array(z.string()),
                      }),
                    ),
                  },
                },
              },
            },
          }),
          async (c) => {
            const config = await Config.get()
            const disabled = new Set(config.disabled_providers ?? [])
            const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

            const allProviders = await ModelsDev.get()
            const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
            for (const [key, value] of Object.entries(allProviders)) {
              if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
                filteredProviders[key] = value
              }
            }

            const connected = await Provider.list()
            const providers = Object.assign(
              mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
              connected,
            )
            return c.json({
              all: Object.values(providers),
              default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
              connected: Object.keys(connected),
            })
          },
        )
        .get(
          "/provider/auth",
          describeRoute({
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
            operationId: "provider.auth",
            responses: {
              200: {
                description: "Provider auth methods",
                content: {
                  "application/json": {
                    schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await ProviderAuth.methods())
          },
        )
        .post(
          "/provider/:providerID/oauth/authorize",
          describeRoute({
            summary: "OAuth authorize",
            description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
            operationId: "provider.oauth.authorize",
            responses: {
              200: {
                description: "Authorization URL and method",
                content: {
                  "application/json": {
                    schema: resolver(ProviderAuth.Authorization.optional()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "param",
            z.object({
              providerID: z.string().meta({ description: "Provider ID" }),
            }),
          ),
          validator(
            "json",
            z.object({
              method: z.number().meta({ description: "Auth method index" }),
            }),
          ),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const { method } = c.req.valid("json")
            const result = await ProviderAuth.authorize({
              providerID,
              method,
            })
            return c.json(result)
          },
        )
        .post(
          "/provider/:providerID/oauth/callback",
          describeRoute({
            summary: "OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
            operationId: "provider.oauth.callback",
            responses: {
              200: {
                description: "OAuth callback processed successfully",
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
              providerID: z.string().meta({ description: "Provider ID" }),
            }),
          ),
          validator(
            "json",
            z.object({
              method: z.number().meta({ description: "Auth method index" }),
              code: z.string().optional().meta({ description: "OAuth authorization code" }),
            }),
          ),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const { method, code } = c.req.valid("json")
            await ProviderAuth.callback({
              providerID,
              method,
              code,
            })
            return c.json(true)
          },
        )
        .get(
          "/find",
          describeRoute({
            summary: "Find text",
            description: "Search for text patterns across files in the project using ripgrep.",
            operationId: "find.text",
            responses: {
              200: {
                description: "Matches",
                content: {
                  "application/json": {
                    schema: resolver(Ripgrep.Match.shape.data.array()),
                  },
                },
              },
            },
          }),
          validator(
            "query",
            z.object({
              pattern: z.string(),
            }),
          ),
          async (c) => {
            const pattern = c.req.valid("query").pattern
            const result = await Ripgrep.search({
              cwd: Instance.directory,
              pattern,
              limit: 10,
            })
            return c.json(result)
          },
        )
        .get(
          "/find/file",
          describeRoute({
            summary: "Find files",
            description: "Search for files or directories by name or pattern in the project directory.",
            operationId: "find.files",
            responses: {
              200: {
                description: "File paths",
                content: {
                  "application/json": {
                    schema: resolver(z.string().array()),
                  },
                },
              },
            },
          }),
          validator(
            "query",
            z.object({
              query: z.string(),
              dirs: z.enum(["true", "false"]).optional(),
              type: z.enum(["file", "directory"]).optional(),
              limit: z.coerce.number().int().min(1).max(200).optional(),
            }),
          ),
          async (c) => {
            const query = c.req.valid("query").query
            const dirs = c.req.valid("query").dirs
            const type = c.req.valid("query").type
            const limit = c.req.valid("query").limit
            const results = await File.search({
              query,
              limit: limit ?? 10,
              dirs: dirs !== "false",
              type,
            })
            return c.json(results)
          },
        )
        .get(
          "/find/symbol",
          describeRoute({
            summary: "Find symbols",
            description: "Search for workspace symbols like functions, classes, and variables using LSP.",
            operationId: "find.symbols",
            responses: {
              200: {
                description: "Symbols",
                content: {
                  "application/json": {
                    schema: resolver(LSP.Symbol.array()),
                  },
                },
              },
            },
          }),
          validator(
            "query",
            z.object({
              query: z.string(),
            }),
          ),
          async (c) => {
            /*
          const query = c.req.valid("query").query
          const result = await LSP.workspaceSymbol(query)
          return c.json(result)
          */
            return c.json([])
          },
        )
        .get(
          "/file",
          describeRoute({
            summary: "List files",
            description: "List files and directories in a specified path.",
            operationId: "file.list",
            responses: {
              200: {
                description: "Files and directories",
                content: {
                  "application/json": {
                    schema: resolver(File.Node.array()),
                  },
                },
              },
            },
          }),
          validator(
            "query",
            z.object({
              path: z.string(),
            }),
          ),
          async (c) => {
            const path = c.req.valid("query").path
            const content = await File.list(path)
            return c.json(content)
          },
        )
        .get(
          "/file/content",
          describeRoute({
            summary: "Read file",
            description: "Read the content of a specified file.",
            operationId: "file.read",
            responses: {
              200: {
                description: "File content",
                content: {
                  "application/json": {
                    schema: resolver(File.Content),
                  },
                },
              },
            },
          }),
          validator(
            "query",
            z.object({
              path: z.string(),
            }),
          ),
          async (c) => {
            const path = c.req.valid("query").path
            const content = await File.read(path)
            return c.json(content)
          },
        )
        .get(
          "/file/status",
          describeRoute({
            summary: "Get file status",
            description: "Get the git status of all files in the project.",
            operationId: "file.status",
            responses: {
              200: {
                description: "File status",
                content: {
                  "application/json": {
                    schema: resolver(File.Info.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const content = await File.status()
            return c.json(content)
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
          "/mcp",
          describeRoute({
            summary: "Get MCP status",
            description: "Get the status of all Model Context Protocol (MCP) servers.",
            operationId: "mcp.status",
            responses: {
              200: {
                description: "MCP server status",
                content: {
                  "application/json": {
                    schema: resolver(z.record(z.string(), MCP.Status)),
                  },
                },
              },
            },
          }),
          async (c) => {
            return c.json(await MCP.status())
          },
        )
        .post(
          "/mcp",
          describeRoute({
            summary: "Add MCP server",
            description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
            operationId: "mcp.add",
            responses: {
              200: {
                description: "MCP server added successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.record(z.string(), MCP.Status)),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator(
            "json",
            z.object({
              name: z.string(),
              config: Config.Mcp,
            }),
          ),
          async (c) => {
            const { name, config } = c.req.valid("json")
            const result = await MCP.add(name, config)
            return c.json(result.status)
          },
        )
        .post(
          "/mcp/:name/auth",
          describeRoute({
            summary: "Start MCP OAuth",
            description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
            operationId: "mcp.auth.start",
            responses: {
              200: {
                description: "OAuth flow started",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                      }),
                    ),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          async (c) => {
            const name = c.req.param("name")
            const supportsOAuth = await MCP.supportsOAuth(name)
            if (!supportsOAuth) {
              return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
            }
            const result = await MCP.startAuth(name)
            return c.json(result)
          },
        )
        .post(
          "/mcp/:name/auth/callback",
          describeRoute({
            summary: "Complete MCP OAuth",
            description:
              "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
            operationId: "mcp.auth.callback",
            responses: {
              200: {
                description: "OAuth authentication completed",
                content: {
                  "application/json": {
                    schema: resolver(MCP.Status),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "json",
            z.object({
              code: z.string().describe("Authorization code from OAuth callback"),
            }),
          ),
          async (c) => {
            const name = c.req.param("name")
            const { code } = c.req.valid("json")
            const status = await MCP.finishAuth(name, code)
            return c.json(status)
          },
        )
        .post(
          "/mcp/:name/auth/authenticate",
          describeRoute({
            summary: "Authenticate MCP OAuth",
            description: "Start OAuth flow and wait for callback (opens browser)",
            operationId: "mcp.auth.authenticate",
            responses: {
              200: {
                description: "OAuth authentication completed",
                content: {
                  "application/json": {
                    schema: resolver(MCP.Status),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          async (c) => {
            const name = c.req.param("name")
            const supportsOAuth = await MCP.supportsOAuth(name)
            if (!supportsOAuth) {
              return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
            }
            const status = await MCP.authenticate(name)
            return c.json(status)
          },
        )
        .delete(
          "/mcp/:name/auth",
          describeRoute({
            summary: "Remove MCP OAuth",
            description: "Remove OAuth credentials for an MCP server",
            operationId: "mcp.auth.remove",
            responses: {
              200: {
                description: "OAuth credentials removed",
                content: {
                  "application/json": {
                    schema: resolver(z.object({ success: z.literal(true) })),
                  },
                },
              },
              ...errors(404),
            },
          }),
          async (c) => {
            const name = c.req.param("name")
            await MCP.removeAuth(name)
            return c.json({ success: true as const })
          },
        )
        .post(
          "/mcp/:name/connect",
          describeRoute({
            description: "Connect an MCP server",
            operationId: "mcp.connect",
            responses: {
              200: {
                description: "MCP server connected successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          validator("param", z.object({ name: z.string() })),
          async (c) => {
            const { name } = c.req.valid("param")
            await MCP.connect(name)
            return c.json(true)
          },
        )
        .post(
          "/mcp/:name/disconnect",
          describeRoute({
            description: "Disconnect an MCP server",
            operationId: "mcp.disconnect",
            responses: {
              200: {
                description: "MCP server disconnected successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          validator("param", z.object({ name: z.string() })),
          async (c) => {
            const { name } = c.req.valid("param")
            await MCP.disconnect(name)
            return c.json(true)
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
        .post(
          "/tui/append-prompt",
          describeRoute({
            summary: "Append TUI prompt",
            description: "Append prompt to the TUI",
            operationId: "tui.appendPrompt",
            responses: {
              200: {
                description: "Prompt processed successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator("json", TuiEvent.PromptAppend.properties),
          async (c) => {
            await Bus.publish(TuiEvent.PromptAppend, c.req.valid("json"))
            return c.json(true)
          },
        )
        .post(
          "/tui/open-help",
          describeRoute({
            summary: "Open help dialog",
            description: "Open the help dialog in the TUI to display user assistance information.",
            operationId: "tui.openHelp",
            responses: {
              200: {
                description: "Help dialog opened successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            // TODO: open dialog
            return c.json(true)
          },
        )
        .post(
          "/tui/open-sessions",
          describeRoute({
            summary: "Open sessions dialog",
            description: "Open the session dialog",
            operationId: "tui.openSessions",
            responses: {
              200: {
                description: "Session dialog opened successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Bus.publish(TuiEvent.CommandExecute, {
              command: "session.list",
            })
            return c.json(true)
          },
        )
        .post(
          "/tui/open-themes",
          describeRoute({
            summary: "Open themes dialog",
            description: "Open the theme dialog",
            operationId: "tui.openThemes",
            responses: {
              200: {
                description: "Theme dialog opened successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Bus.publish(TuiEvent.CommandExecute, {
              command: "session.list",
            })
            return c.json(true)
          },
        )
        .post(
          "/tui/open-models",
          describeRoute({
            summary: "Open models dialog",
            description: "Open the model dialog",
            operationId: "tui.openModels",
            responses: {
              200: {
                description: "Model dialog opened successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Bus.publish(TuiEvent.CommandExecute, {
              command: "model.list",
            })
            return c.json(true)
          },
        )
        .post(
          "/tui/submit-prompt",
          describeRoute({
            summary: "Submit TUI prompt",
            description: "Submit the prompt",
            operationId: "tui.submitPrompt",
            responses: {
              200: {
                description: "Prompt submitted successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Bus.publish(TuiEvent.CommandExecute, {
              command: "prompt.submit",
            })
            return c.json(true)
          },
        )
        .post(
          "/tui/clear-prompt",
          describeRoute({
            summary: "Clear TUI prompt",
            description: "Clear the prompt",
            operationId: "tui.clearPrompt",
            responses: {
              200: {
                description: "Prompt cleared successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          async (c) => {
            await Bus.publish(TuiEvent.CommandExecute, {
              command: "prompt.clear",
            })
            return c.json(true)
          },
        )
        .post(
          "/tui/execute-command",
          describeRoute({
            summary: "Execute TUI command",
            description: "Execute a TUI command (e.g. agent_cycle)",
            operationId: "tui.executeCommand",
            responses: {
              200: {
                description: "Command executed successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator("json", z.object({ command: z.string() })),
          async (c) => {
            const command = c.req.valid("json").command
            await Bus.publish(TuiEvent.CommandExecute, {
              // @ts-expect-error
              command: {
                session_new: "session.new",
                session_share: "session.share",
                session_interrupt: "session.interrupt",
                session_compact: "session.compact",
                messages_page_up: "session.page.up",
                messages_page_down: "session.page.down",
                messages_half_page_up: "session.half.page.up",
                messages_half_page_down: "session.half.page.down",
                messages_first: "session.first",
                messages_last: "session.last",
                agent_cycle: "agent.cycle",
              }[command],
            })
            return c.json(true)
          },
        )
        .post(
          "/tui/show-toast",
          describeRoute({
            summary: "Show TUI toast",
            description: "Show a toast notification in the TUI",
            operationId: "tui.showToast",
            responses: {
              200: {
                description: "Toast notification shown successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
            },
          }),
          validator("json", TuiEvent.ToastShow.properties),
          async (c) => {
            await Bus.publish(TuiEvent.ToastShow, c.req.valid("json"))
            return c.json(true)
          },
        )
        .post(
          "/tui/publish",
          describeRoute({
            summary: "Publish TUI event",
            description: "Publish a TUI event",
            operationId: "tui.publish",
            responses: {
              200: {
                description: "Event published successfully",
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
            z.union(
              Object.values(TuiEvent).map((def) => {
                return z
                  .object({
                    type: z.literal(def.type),
                    properties: def.properties,
                  })
                  .meta({
                    ref: "Event" + "." + def.type,
                  })
              }),
            ),
          ),
          async (c) => {
            const evt = c.req.valid("json")
            await Bus.publish(Object.values(TuiEvent).find((def) => def.type === evt.type)!, evt.properties)
            return c.json(true)
          },
        )
        .post(
          "/tui/select-session",
          describeRoute({
            summary: "Select session",
            description: "Navigate the TUI to display the specified session.",
            operationId: "tui.selectSession",
            responses: {
              200: {
                description: "Session selected successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator("json", TuiEvent.SessionSelect.properties),
          async (c) => {
            const { sessionID } = c.req.valid("json")
            await Session.get(sessionID)
            await Bus.publish(TuiEvent.SessionSelect, { sessionID })
            return c.json(true)
          },
        )
        .route("/tui/control", TuiRoute)
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
          const path = c.req.path
          const response = await proxy(`https://app.opencode.ai${path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
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
