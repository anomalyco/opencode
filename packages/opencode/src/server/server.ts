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
import { mapValues } from "remeda"
import { NamedError } from "../util/error"
import { ModelsDev } from "../provider/models"
import { Ripgrep } from "../file/ripgrep"
import { Config } from "../config/config"

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
        "/doc",
        openAPISpecs(app, {
          documentation: {
            info: {
              title: "opencode",
              version: "0.0.2",
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
      .get(
        "/app",
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
        "/app/init",
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
      .get(
        "/config",
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
      .get(
        "/session",
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
        "/session",
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
      .delete(
        "/session/:id",
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
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        async (c) => {
          await Session.remove(c.req.valid("param").id)
          return c.json(true)
        },
      )
      .post(
        "/session/:id/init",
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
          "param",
          z.object({
            id: z.string().openapi({ description: "Session ID" }),
          }),
        ),
        zValidator(
          "json",
          z.object({
            providerID: z.string(),
            modelID: z.string(),
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const body = c.req.valid("json")
          await Session.initialize({ ...body, sessionID })
          return c.json(true)
        },
      )
      .post(
        "/session/:id/abort",
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
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        async (c) => {
          return c.json(Session.abort(c.req.valid("param").id))
        },
      )
      .post(
        "/session/:id/share",
        describeRoute({
          description: "Share a session",
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
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        async (c) => {
          const id = c.req.valid("param").id
          await Session.share(id)
          const session = await Session.get(id)
          return c.json(session)
        },
      )
      .delete(
        "/session/:id/share",
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
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        async (c) => {
          const id = c.req.valid("param").id
          await Session.unshare(id)
          const session = await Session.get(id)
          return c.json(session)
        },
      )
      .post(
        "/session/:id/summarize",
        describeRoute({
          description: "Summarize the session",
          responses: {
            200: {
              description: "Summarized session",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
          },
        }),
        zValidator(
          "param",
          z.object({
            id: z.string().openapi({ description: "Session ID" }),
          }),
        ),
        zValidator(
          "json",
          z.object({
            providerID: z.string(),
            modelID: z.string(),
          }),
        ),
        async (c) => {
          const id = c.req.valid("param").id
          const body = c.req.valid("json")
          await Session.summarize({ ...body, sessionID: id })
          return c.json(true)
        },
      )
      .get(
        "/session/:id/message",
        describeRoute({
          description: "List messages for a session",
          responses: {
            200: {
              description: "List of messages",
              content: {
                "application/json": {
                  schema: resolver(Message.Info.array()),
                },
              },
            },
          },
        }),
        zValidator(
          "param",
          z.object({
            id: z.string().openapi({ description: "Session ID" }),
          }),
        ),
        async (c) => {
          const messages = await Session.messages(c.req.valid("param").id)
          return c.json(messages)
        },
      )
      .post(
        "/session/:id/message",
        describeRoute({
          description: "Create and send a new message to a session",
          responses: {
            200: {
              description: "Created message",
              content: {
                "application/json": {
                  schema: resolver(Message.Info),
                },
              },
            },
          },
        }),
        zValidator(
          "param",
          z.object({
            id: z.string().openapi({ description: "Session ID" }),
          }),
        ),
        zValidator(
          "json",
          z.object({
            providerID: z.string(),
            modelID: z.string(),
            parts: Message.MessagePart.array(),
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const body = c.req.valid("json")
          const msg = await Session.chat({ ...body, sessionID })
          return c.json(msg)
        },
      )
      .get(
        "/config/providers",
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
      .get(
        "/file",
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
          "query",
          z.object({
            query: z.string(),
          }),
        ),
        async (c) => {
          const query = c.req.valid("query").query
          const app = App.info()
          const result = await Ripgrep.files({
            cwd: app.path.cwd,
            query,
            limit: 10,
          })
          return c.json(result)
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
