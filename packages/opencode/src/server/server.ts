import { Log } from "../util/log"
import { Bus } from "../bus"
import {
  describeRoute,
  generateSpecs,
  validator,
  resolver,
  openAPIRouteHandler,
} from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { stream, streamSSE } from "hono/streaming"
import { Session } from "../session"
import z from "zod"
import { Provider } from "../provider/provider"
import { mapValues } from "remeda"
import { NamedError } from "../util/error"
import { ModelsDev } from "../provider/models"
import { Ripgrep } from "../file/ripgrep"
import { Config } from "../config/config"
import { File } from "../file"
import { LSP } from "../lsp"
import { Format } from "../format"
import { MessageV2 } from "../session/message-v2"
import { TuiRoute } from "./tui"
import { Permission } from "../permission"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"
import { Auth } from "../auth"
import { Command } from "../command"
import { Global } from "../global"
import { ProjectRoute } from "./project"
import { ToolRegistry } from "../tool/registry"
import { zodToJsonSchema } from "zod-to-json-schema"
import { SessionLock } from "../session/lock"
import { SessionPrompt } from "../session/prompt"
import { SessionCompaction } from "../session/compaction"
import { SessionRevert } from "../session/revert"
import { lazy } from "../util/lazy"
import { Todo } from "../session/todo"
import { InstanceBootstrap } from "../project/bootstrap"
import { MCP } from "../mcp"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "@/session/summary"

const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              data: z.any().nullable(),
              errors: z.array(z.record(z.string(), z.any())),
              success: z.literal(false),
            })
            .meta({
              ref: "BadRequestError",
            }),
        ),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(Storage.NotFoundError.Schema),
      },
    },
  },
} as const

function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}

export namespace Server {
  const log = Log.create({ service: "server" })

  export const Event = {
    Connected: Bus.event("server.connected", z.object({})),
  }

  const app = new Hono()
  export const App = lazy(() =>
    app
      .onError((err, c) => {
        log.error("failed", {
          error: err,
        })
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof Storage.NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
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
        const start = Date.now()
        await next()
        if (!skipLogging) {
          log.info("response", {
            duration: Date.now() - start,
          })
        }
      })
      .use(async (c, next) => {
        const directory = c.req.query("directory") ?? process.cwd()
        return Instance.provide({
          directory,
          init: InstanceBootstrap,
          async fn() {
            return next()
          },
        })
      })
      .use(cors())
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
        "/config",
        describeRoute({
          description: "Get config info",
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
          description: "Update config",
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
          description: "List all tool IDs (including built-in and dynamically registered)",
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
          description: "List tools with JSON schema parameters for a provider/model",
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
          const { provider, model } = c.req.valid("query")
          const tools = await ToolRegistry.tools(provider, model)
          return c.json(
            tools.map((t) => ({
              id: t.id,
              description: t.description,
              // Handle both Zod schemas and plain JSON schemas
              parameters: (t.parameters as any)?._def
                ? zodToJsonSchema(t.parameters as any)
                : t.parameters,
            })),
          )
        },
      )
      .get(
        "/path",
        describeRoute({
          description: "Get the current path",
          operationId: "path.get",
          responses: {
            200: {
              description: "Path",
              content: {
                "application/json": {
                  schema: resolver(
                    z
                      .object({
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
            state: Global.Path.state,
            config: Global.Path.config,
            worktree: Instance.worktree,
            directory: Instance.directory,
          })
        },
      )
      .get(
        "/session",
        describeRoute({
          description: "List all sessions",
          operationId: "session.list",
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
          sessions.sort((a, b) => b.time.updated - a.time.updated)
          return c.json(sessions)
        },
      )
      .get(
        "/session/:id",
        describeRoute({
          description: "Get session",
          operationId: "session.get",
          responses: {
            200: {
              description: "Get session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: Session.get.schema,
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const session = await Session.get(sessionID)
          return c.json(session)
        },
      )
      .get(
        "/session/:id/children",
        describeRoute({
          description: "Get a session's children",
          operationId: "session.children",
          responses: {
            200: {
              description: "List of children",
              content: {
                "application/json": {
                  schema: resolver(Session.Info.array()),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: Session.children.schema,
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const session = await Session.children(sessionID)
          return c.json(session)
        },
      )
      .get(
        "/session/:id/todo",
        describeRoute({
          description: "Get the todo list for a session",
          operationId: "session.todo",
          responses: {
            200: {
              description: "Todo list",
              content: {
                "application/json": {
                  schema: resolver(Todo.Info.array()),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const todos = await Todo.get(sessionID)
          return c.json(todos)
        },
      )
      .post(
        "/session",
        describeRoute({
          description: "Create a new session",
          operationId: "session.create",
          responses: {
            ...errors(400),
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
        validator("json", Session.create.schema.optional()),
        async (c) => {
          const body = c.req.valid("json") ?? {}
          const session = await Session.create(body)
          return c.json(session)
        },
      )
      .delete(
        "/session/:id",
        describeRoute({
          description: "Delete a session and all its data",
          operationId: "session.delete",
          responses: {
            200: {
              description: "Successfully deleted session",
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
            id: Session.remove.schema,
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          await Session.remove(sessionID)
          await Bus.publish(TuiEvent.CommandExecute, {
            command: "session.list",
          })
          return c.json(true)
        },
      )
      .patch(
        "/session/:id",
        describeRoute({
          description: "Update session properties",
          operationId: "session.update",
          responses: {
            200: {
              description: "Successfully updated session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        validator(
          "json",
          z.object({
            title: z.string().optional(),
          }),
        ),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const updates = c.req.valid("json")

          const updatedSession = await Session.update(sessionID, (session) => {
            if (updates.title !== undefined) {
              session.title = updates.title
            }
          })

          return c.json(updatedSession)
        },
      )
      .post(
        "/session/:id/init",
        describeRoute({
          description: "Analyze the app and create an AGENTS.md file",
          operationId: "session.init",
          responses: {
            200: {
              description: "200",
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
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        validator("json", Session.initialize.schema.omit({ sessionID: true })),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const body = c.req.valid("json")
          await Session.initialize({ ...body, sessionID })
          return c.json(true)
        },
      )
      .post(
        "/session/:id/fork",
        describeRoute({
          description: "Fork an existing session at a specific message",
          operationId: "session.fork",
          responses: {
            200: {
              description: "200",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
          },
        }),
        validator(
          "param",
          z.object({
            id: Session.fork.schema.shape.sessionID,
          }),
        ),
        validator("json", Session.fork.schema.omit({ sessionID: true })),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const body = c.req.valid("json")
          const result = await Session.fork({ ...body, sessionID })
          return c.json(result)
        },
      )
      .post(
        "/session/:id/abort",
        describeRoute({
          description: "Abort a session",
          operationId: "session.abort",
          responses: {
            200: {
              description: "Aborted session",
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
            id: z.string(),
          }),
        ),
        async (c) => {
          return c.json(SessionLock.abort(c.req.valid("param").id))
        },
      )
      .post(
        "/session/:id/share",
        describeRoute({
          description: "Share a session",
          operationId: "session.share",
          responses: {
            200: {
              description: "Successfully shared session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
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
      .get(
        "/session/:id/diff",
        describeRoute({
          description: "Get the diff that resulted from this user message",
          operationId: "session.diff",
          responses: {
            200: {
              description: "Successfully retrieved diff",
              content: {
                "application/json": {
                  schema: resolver(Snapshot.FileDiff.array()),
                },
              },
            },
          },
        }),
        validator(
          "param",
          z.object({
            id: SessionSummary.diff.schema.shape.sessionID,
          }),
        ),
        validator(
          "query",
          z.object({
            messageID: SessionSummary.diff.schema.shape.messageID,
          }),
        ),
        async (c) => {
          const query = c.req.valid("query")
          const params = c.req.valid("param")
          const result = await SessionSummary.diff({
            sessionID: params.id,
            messageID: query.messageID,
          })
          return c.json(result)
        },
      )
      .delete(
        "/session/:id/share",
        describeRoute({
          description: "Unshare the session",
          operationId: "session.unshare",
          responses: {
            200: {
              description: "Successfully unshared session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: Session.unshare.schema,
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
          operationId: "session.summarize",
          responses: {
            200: {
              description: "Summarized session",
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
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        validator(
          "json",
          z.object({
            providerID: z.string(),
            modelID: z.string(),
          }),
        ),
        async (c) => {
          const id = c.req.valid("param").id
          const body = c.req.valid("json")
          await SessionCompaction.run({ ...body, sessionID: id })
          return c.json(true)
        },
      )
      .get(
        "/session/:id/message",
        describeRoute({
          description: "List messages for a session",
          operationId: "session.messages",
          responses: {
            200: {
              description: "List of messages",
              content: {
                "application/json": {
                  schema: resolver(MessageV2.WithParts.array()),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        async (c) => {
          const messages = await Session.messages(c.req.valid("param").id)
          return c.json(messages)
        },
      )
      .get(
        "/session/:id/message/:messageID",
        describeRoute({
          description: "Get a message from a session",
          operationId: "session.message",
          responses: {
            200: {
              description: "Message",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      info: MessageV2.Info,
                      parts: MessageV2.Part.array(),
                    }),
                  ),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string().meta({ description: "Session ID" }),
            messageID: z.string().meta({ description: "Message ID" }),
          }),
        ),
        async (c) => {
          const params = c.req.valid("param")
          const message = await Session.getMessage({
            sessionID: params.id,
            messageID: params.messageID,
          })
          return c.json(message)
        },
      )
      .post(
        "/session/:id/message",
        describeRoute({
          description: "Create and send a new message to a session",
          operationId: "session.prompt",
          responses: {
            200: {
              description: "Created message",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      info: MessageV2.Assistant,
                      parts: MessageV2.Part.array(),
                    }),
                  ),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
        async (c) => {
          c.status(200)
          c.header("Content-Type", "application/json")
          return stream(c, async (stream) => {
            const sessionID = c.req.valid("param").id
            const body = c.req.valid("json")
            const msg = await SessionPrompt.prompt({ ...body, sessionID })
            stream.write(JSON.stringify(msg))
          })
        },
      )
      .post(
        "/session/:id/command",
        describeRoute({
          description: "Send a new command to a session",
          operationId: "session.command",
          responses: {
            200: {
              description: "Created message",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      info: MessageV2.Assistant,
                      parts: MessageV2.Part.array(),
                    }),
                  ),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const body = c.req.valid("json")
          const msg = await SessionPrompt.command({ ...body, sessionID })
          return c.json(msg)
        },
      )
      .post(
        "/session/:id/shell",
        describeRoute({
          description: "Run a shell command",
          operationId: "session.shell",
          responses: {
            200: {
              description: "Created message",
              content: {
                "application/json": {
                  schema: resolver(MessageV2.Assistant),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string().meta({ description: "Session ID" }),
          }),
        ),
        validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
        async (c) => {
          const sessionID = c.req.valid("param").id
          const body = c.req.valid("json")
          const msg = await SessionPrompt.shell({ ...body, sessionID })
          return c.json(msg)
        },
      )
      .post(
        "/session/:id/revert",
        describeRoute({
          description: "Revert a message",
          operationId: "session.revert",
          responses: {
            200: {
              description: "Updated session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
        async (c) => {
          const id = c.req.valid("param").id
          log.info("revert", c.req.valid("json"))
          const session = await SessionRevert.revert({
            sessionID: id,
            ...c.req.valid("json"),
          })
          return c.json(session)
        },
      )
      .post(
        "/session/:id/unrevert",
        describeRoute({
          description: "Restore all reverted messages",
          operationId: "session.unrevert",
          responses: {
            200: {
              description: "Updated session",
              content: {
                "application/json": {
                  schema: resolver(Session.Info),
                },
              },
            },
            ...errors(400, 404),
          },
        }),
        validator(
          "param",
          z.object({
            id: z.string(),
          }),
        ),
        async (c) => {
          const id = c.req.valid("param").id
          const session = await SessionRevert.unrevert({ sessionID: id })
          return c.json(session)
        },
      )
      .post(
        "/session/:id/permissions/:permissionID",
        describeRoute({
          description: "Respond to a permission request",
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
            id: z.string(),
            permissionID: z.string(),
          }),
        ),
        validator("json", z.object({ response: Permission.Response })),
        async (c) => {
          const params = c.req.valid("param")
          const id = params.id
          const permissionID = params.permissionID
          Permission.respond({
            sessionID: id,
            permissionID,
            response: c.req.valid("json").response,
          })
          return c.json(true)
        },
      )
      .get(
        "/command",
        describeRoute({
          description: "List all commands",
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
          description: "List all providers",
          operationId: "config.providers",
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
          const providers = await Provider.list().then((x) => mapValues(x, (item) => item.info))
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
        "/find",
        describeRoute({
          description: "Find text in files",
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
          description: "Find files",
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
            dirs: z.boolean().optional(),
          }),
        ),
        async (c) => {
          const query = c.req.valid("query").query
          const dirs = c.req.valid("query").dirs
          const results = await File.search({
            query,
            limit: 10,
            dirs,
          })
          return c.json(results)
        },
      )
      .get(
        "/find/symbol",
        describeRoute({
          description: "Find workspace symbols",
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
          description: "List files and directories",
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
          description: "Read a file",
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
          description: "Get file status",
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
          description: "Write a log entry to the server logs",
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
          description: "List all agents",
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
          description: "Get MCP server status",
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
      .get(
        "/lsp",
        describeRoute({
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
          description: "Open the help dialog",
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
          await Bus.publish(
            Object.values(TuiEvent).find((def) => def.type === evt.type)!,
            evt.properties,
          )
          return c.json(true)
        },
      )
      .route("/tui/control", TuiRoute)
      .put(
        "/auth/:id",
        describeRoute({
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
            id: z.string(),
          }),
        ),
        validator("json", Auth.Info),
        async (c) => {
          const id = c.req.valid("param").id
          const info = c.req.valid("json")
          await Auth.set(id, info)
          return c.json(true)
        },
      )
      .get(
        "/event",
        describeRoute({
          description: "Get events",
          operationId: "event.subscribe",
          responses: {
            200: {
              description: "Event stream",
              content: {
                "text/event-stream": {
                  schema: resolver(
                    Bus.payloads().meta({
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
              data: JSON.stringify({
                type: "server.connected",
                properties: {},
              }),
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
      ),
  )

  export async function openapi() {
    const result = await generateSpecs(App(), {
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

  export function listen(opts: { port: number; hostname: string }) {
    const server = Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
    })
    return server
  }
}
