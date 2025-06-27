import { Log } from "../util/log"
import { Bus } from "../bus"
import { describeRoute, generateSpecs, openAPISpecs } from "hono-openapi"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { Session } from "../session"
import { resolver, validator as zValidator } from "hono-openapi/zod"
import { z } from "zod"
import { Message } from "../session/message"
import { Provider } from "../provider/provider"
import { App } from "../app/app"
import { Global } from "../global"
import { mapValues } from "remeda"
import { NamedError } from "../util/error"
import { ModelsDev } from "../provider/models"
import { Ripgrep } from "../external/ripgrep"
import { Installation } from "../installation"
import { Config } from "../config/config"
import { Auth } from "../auth"
import { AuthAnthropic } from "../auth/anthropic"
import { AuthCopilot } from "../auth/copilot"

const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              data: z.record(z.string(), z.any()),
            })
            .openapi({
              ref: "Error",
            }),
        ),
      },
    },
  },
} as const

export namespace Server {
  const log = Log.create({ service: "server" })

  export type Routes = ReturnType<typeof app>

  function app() {
    const app = new Hono()

    const result = app
      .onError((err, c) => {
        if (err instanceof NamedError) {
          return c.json(err.toObject(), {
            status: 400,
          })
        }
        return c.json(
          new NamedError.Unknown({ message: err.toString() }).toObject(),
          {
            status: 400,
          },
        )
      })
      .use(async (c, next) => {
        log.info("request", {
          method: c.req.method,
          path: c.req.path,
        })
        const start = Date.now()
        await next()
        log.info("response", {
          duration: Date.now() - start,
        })
      })
      .get(
        "/openapi",
        openAPISpecs(app, {
          documentation: {
            info: {
              title: "opencode",
              version: "1.0.0",
              description: "opencode api",
            },
            openapi: "3.0.0",
          },
        }),
      )
      .get(
        "/event",
        describeRoute({
          description: "Get events",
          responses: {
            200: {
              description: "Event stream",
              content: {
                "application/json": {
                  schema: resolver(
                    Bus.payloads().openapi({
                      ref: "Event",
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          log.info("event connected")
          return streamSSE(c, async (stream) => {
            stream.writeSSE({
              data: JSON.stringify({}),
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
      .post(
        "/app_info",
        describeRoute({
          description: "Get app info",
          responses: {
            200: {
              description: "200",
              content: {
                "application/json": {
                  schema: resolver(App.Info),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(App.info())
        },
      )
      .post(
        "/config_get",
        describeRoute({
          description: "Get config info",
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
      .post(
        "/app_initialize",
        describeRoute({
          description: "Initialize the app",
          responses: {
            200: {
              description: "Initialize the app",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        async (c) => {
          await App.initialize()
          return c.json(true)
        },
      )
      .post(
        "/session_initialize",
        describeRoute({
          description: "Analyze the app and create an AGENTS.md file",
          responses: {
            200: {
              description: "200",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
            providerID: z.string(),
            modelID: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          await Session.initialize(body)
          return c.json(true)
        },
      )
      .post(
        "/path_get",
        describeRoute({
          description: "Get paths",
          responses: {
            200: {
              description: "200",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      root: z.string(),
                      data: z.string(),
                      cwd: z.string(),
                      config: z.string(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          const app = App.info()
          return c.json({
            root: app.path.root,
            data: app.path.data,
            cwd: app.path.cwd,
            config: Global.Path.data,
          })
        },
      )
      .post(
        "/session_create",
        describeRoute({
          description: "Create a new session",
          responses: {
            ...ERRORS,
            200: {
              description: "Successfully created session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
          },
        }),
        async (c) => {
          const session = await Session.create()
          return c.json(session)
        },
      )
      .post(
        "/session_share",
        describeRoute({
          description: "Share the session",
          responses: {
            200: {
              description: "Successfully shared session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          await Session.share(body.sessionID)
          const session = await Session.get(body.sessionID)
          return c.json(session)
        },
      )
      .post(
        "/session_unshare",
        describeRoute({
          description: "Unshare the session",
          responses: {
            200: {
              description: "Successfully unshared session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          await Session.unshare(body.sessionID)
          const session = await Session.get(body.sessionID)
          return c.json(session)
        },
      )
      .post(
        "/session_messages",
        describeRoute({
          description: "Get messages for a session",
          responses: {
            200: {
              description: "Successfully created session",
              content: {
                "application/json": {
                  schema: resolver(Message.Info.array()),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
          }),
        ),
        async (c) => {
          const messages = await Session.messages(c.req.valid("json").sessionID)
          return c.json(messages)
        },
      )
      .post(
        "/session_list",
        describeRoute({
          description: "List all sessions",
          responses: {
            200: {
              description: "List of sessions",
              content: {
                "application/json": {
                  schema: resolver(Session.Info.array()),
                },
              },
            },
          },
        }),
        async (c) => {
          const sessions = await Array.fromAsync(Session.list())
          return c.json(sessions)
        },
      )
      .post(
        "/session_abort",
        describeRoute({
          description: "Abort a session",
          responses: {
            200: {
              description: "Aborted session",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          return c.json(Session.abort(body.sessionID))
        },
      )
      .post(
        "/session_delete",
        describeRoute({
          description: "Delete a session and all its data",
          responses: {
            200: {
              description: "Successfully deleted session",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          await Session.remove(body.sessionID)
          return c.json(true)
        },
      )
      .post(
        "/session_summarize",
        describeRoute({
          description: "Summarize the session",
          responses: {
            200: {
              description: "Summarize the session",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
            providerID: z.string(),
            modelID: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          await Session.summarize(body)
          return c.json(true)
        },
      )
      .post(
        "/session_chat",
        describeRoute({
          description: "Chat with a model",
          responses: {
            200: {
              description: "Chat with a model",
              content: {
                "application/json": {
                  schema: resolver(Message.Info),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            sessionID: z.string(),
            providerID: z.string(),
            modelID: z.string(),
            parts: Message.Part.array(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          const msg = await Session.chat(body)
          return c.json(msg)
        },
      )
      .post(
        "/provider_list",
        describeRoute({
          description: "List all providers",
          responses: {
            200: {
              description: "List of providers",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      providers: ModelsDev.Provider.array(),
                      default: z.record(z.string(), z.string()),
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          const providers = await Provider.list().then((x) =>
            mapValues(x, (item) => item.info),
          )
          return c.json({
            providers: Object.values(providers),
            default: mapValues(
              providers,
              (item) => Provider.sort(Object.values(item.models))[0].id,
            ),
          })
        },
      )
      .post(
        "/auth/providers",
        describeRoute({
          description: "List providers available for authentication",
          responses: {
            200: {
              description: "List of providers",
              content: {
                "application/json": {
                  schema: resolver(
                    z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        authType: z.enum(["oauth", "api", "env"]),
                        authenticated: z.boolean(),
                      }),
                    ),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          const providers = await ModelsDev.get()
          const authData = await Auth.all()
          const priority: Record<string, number> = {
            anthropic: 0,
            "github-copilot": 1,
            openai: 2,
            google: 3,
          }
          
          const authProviders = Object.entries(providers)
            .filter(([id]) => id !== "amazon-bedrock") // Special case handled differently
            .map(([id, provider]) => {
              let authType: "oauth" | "api" | "env" = "api"
              if (id === "anthropic" || id === "github-copilot") {
                authType = "oauth"
              } else if (id === "amazon-bedrock") {
                authType = "env"
              }
              return {
                id,
                name: provider.name || id,
                authType,
                authenticated: !!authData[id],
                priority: priority[id] ?? 99,
              }
            })
            .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
            .map(({ priority, ...rest }) => rest)
          
          return c.json(authProviders)
        },
      )
      .post(
        "/auth/start",
        describeRoute({
          description: "Start OAuth authentication flow",
          responses: {
            200: {
              description: "OAuth authorization URL",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      url: z.string(),
                      verifier: z.string().optional(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            providerId: z.string(),
          }),
        ),
        async (c) => {
          const { providerId } = c.req.valid("json")
          
          if (providerId === "anthropic") {
            const result = await AuthAnthropic.authorize()
            return c.json(result)
          }
          
          if (providerId === "github-copilot") {
            const copilot = await AuthCopilot()
            if (!copilot) {
              throw new Error("GitHub Copilot auth not available")
            }
            const deviceInfo = await copilot.authorize()
            return c.json({
              url: deviceInfo.verification,
              verifier: deviceInfo.user,
              deviceCode: deviceInfo.device,
              interval: deviceInfo.interval,
            })
          }
          
          throw new Error(`OAuth not supported for provider: ${providerId}`)
        },
      )
      .post(
        "/auth/exchange",
        describeRoute({
          description: "Exchange OAuth code for tokens",
          responses: {
            200: {
              description: "Authentication successful",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      success: z.boolean(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            providerId: z.string(),
            code: z.string(),
            verifier: z.string().optional(),
          }),
        ),
        async (c) => {
          const { providerId, code, verifier } = c.req.valid("json")
          
          if (providerId === "anthropic") {
            if (!verifier) {
              throw new Error("Verifier required for Anthropic OAuth")
            }
            await AuthAnthropic.exchange(code, verifier)
            return c.json({ success: true })
          }
          
          throw new Error(`OAuth exchange not supported for provider: ${providerId}`)
        },
      )
      .post(
        "/auth/poll",
        describeRoute({
          description: "Poll GitHub Copilot device flow",
          responses: {
            200: {
              description: "Poll status",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      status: z.enum(["pending", "success", "failed"]),
                    }),
                  ),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            deviceCode: z.string(),
          }),
        ),
        async (c) => {
          const { deviceCode } = c.req.valid("json")
          const copilot = await AuthCopilot()
          if (!copilot) {
            throw new Error("GitHub Copilot auth not available")
          }
          
          const response = await copilot.poll(deviceCode)
          if (response.status === "success") {
            await Auth.set("github-copilot", {
              type: "oauth",
              refresh: response.refresh,
              access: response.access,
              expires: response.expires,
            })
          }
          
          return c.json({ status: response.status })
        },
      )
      .post(
        "/auth/apikey",
        describeRoute({
          description: "Set API key for a provider",
          responses: {
            200: {
              description: "API key set successfully",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      success: z.boolean(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            providerId: z.string(),
            apiKey: z.string(),
          }),
        ),
        async (c) => {
          const { providerId, apiKey } = c.req.valid("json")
          await Auth.set(providerId, {
            type: "api",
            key: apiKey,
          })
          return c.json({ success: true })
        },
      )
      .post(
        "/auth/remove",
        describeRoute({
          description: "Remove authentication for a provider",
          responses: {
            200: {
              description: "Authentication removed successfully",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      success: z.boolean(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            providerId: z.string(),
          }),
        ),
        async (c) => {
          const { providerId } = c.req.valid("json")
          await Auth.remove(providerId)
          return c.json({ success: true })
        },
      )
      .post(
        "/file_search",
        describeRoute({
          description: "Search for files",
          responses: {
            200: {
              description: "Search for files",
              content: {
                "application/json": {
                  schema: resolver(z.string().array()),
                },
              },
            },
          },
        }),
        zValidator(
          "json",
          z.object({
            query: z.string(),
          }),
        ),
        async (c) => {
          const body = c.req.valid("json")
          const app = App.info()
          const result = await Ripgrep.files({
            cwd: app.path.cwd,
            query: body.query,
            limit: 10,
          })
          return c.json(result)
        },
      )
      .post(
        "installation_info",
        describeRoute({
          description: "Get installation info",
          responses: {
            200: {
              description: "Get installation info",
              content: {
                "application/json": {
                  schema: resolver(Installation.Info),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(Installation.info())
        },
      )

    return result
  }

  export async function openapi() {
    const a = app()
    const result = await generateSpecs(a, {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.0.0",
      },
    })
    return result
  }

  export function listen(opts: { port: number; hostname: string }) {
    const server = Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app().fetch,
    })
    return server
  }
}
