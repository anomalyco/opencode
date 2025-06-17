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
import { Fzf } from "../external/fzf"
import { ModelsDev } from "../provider/models"
import { Ripgrep } from "../external/ripgrep"
import { Installation } from "../installation"

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

  export function listen() {
    const server = Bun.serve({
      port: 0,
      hostname: "0.0.0.0",
      idleTimeout: 0,
      fetch: app().fetch,
    })
    return server
  }
}
