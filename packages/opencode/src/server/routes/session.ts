import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID, MessageID, PartID } from "@/session/schema"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { SessionCompaction } from "../../session/compaction"
import { SessionRevert } from "../../session/revert"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "../../session/todo"
import { Agent } from "../../agent/agent"
import { Snapshot } from "@/snapshot"
import { Log } from "../../util/log"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Bus } from "../../bus"
import { NamedError } from "@opencode-ai/util/error"
import { ToolRegistry } from "../../tool/registry"

const log = Log.create({ service: "server" })

export const SessionRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List sessions",
        description: "Get a list of all OpenCode sessions, sorted by most recently updated.",
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
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessions: Session.Info[] = []
        for await (const session of Session.list({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          search: query.search,
          limit: query.limit,
        })) {
          sessions.push(session)
        }
        return c.json(sessions)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get session status",
        description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
        operationId: "session.status",
        responses: {
          200: {
            description: "Get session status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), SessionStatus.Info)),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = await SessionStatus.list()
        return c.json(Object.fromEntries(result))
      },
    )
    .get(
      "/:sessionID",
      describeRoute({
        summary: "Get session",
        description: "Retrieve detailed information about a specific OpenCode session.",
        tags: ["Session"],
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
          sessionID: Session.get.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("SEARCH", { url: c.req.url })
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/children",
      describeRoute({
        summary: "Get session children",
        tags: ["Session"],
        description: "Retrieve all child sessions that were forked from the specified parent session.",
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
          sessionID: Session.children.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.children(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/todo",
      describeRoute({
        summary: "Get session todos",
        description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
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
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const todos = await Todo.get(sessionID)
        return c.json(todos)
      },
    )
    .post(
      "/:sessionID/todo",
      describeRoute({
        summary: "Create session todo",
        description: "Create a new todo item for the session.",
        operationId: "session.todo.create",
        responses: {
          200: { description: "Created todo", content: { "application/json": { schema: resolver(Todo.Info) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({ content: z.string(), status: z.string().optional(), priority: z.string().optional() }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const todo: Todo.Info = {
          content: body.content,
          status: body.status ?? "pending",
          priority: body.priority ?? "medium",
        }
        const existing = Todo.get(sessionID)
        Todo.update({ sessionID, todos: [...existing, todo] })
        return c.json(todo)
      },
    )
    .put(
      "/:sessionID/todo",
      describeRoute({
        summary: "Update session todos",
        description: "Replace all todos for a session (bulk update).",
        operationId: "session.todo.update",
        responses: {
          200: {
            description: "Updated todos",
            content: { "application/json": { schema: resolver(Todo.Info.array()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ todos: z.array(Todo.Info) })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        Todo.update({ sessionID, todos: body.todos })
        return c.json(body.todos)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create session",
        description: "Create a new OpenCode session for interacting with AI assistants and managing conversations.",
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
      "/:sessionID",
      describeRoute({
        summary: "Delete session",
        description: "Delete a session and permanently remove all associated data, including messages and history.",
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
          sessionID: Session.remove.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.remove(sessionID)
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID",
      describeRoute({
        summary: "Update session",
        description: "Update properties of an existing session, such as title or other metadata.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          time: z
            .object({
              archived: z.number().optional(),
            })
            .optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const updates = c.req.valid("json")

        if (updates.title !== undefined) {
          await Session.setTitle({ sessionID, title: updates.title })
        }
        if (updates.time?.archived !== undefined) {
          await Session.setArchived({ sessionID, time: updates.time.archived })
        }

        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/init",
      describeRoute({
        summary: "Initialize session",
        description:
          "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", Session.initialize.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await Session.initialize({ ...body, sessionID })
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/fork",
      describeRoute({
        summary: "Fork session",
        description: "Create a new session by forking an existing session at a specific message point.",
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
          sessionID: Session.fork.schema.shape.sessionID,
        }),
      ),
      validator("json", Session.fork.schema.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const result = await Session.fork({ ...body, sessionID })
        return c.json(result)
      },
    )
    .post(
      "/:sessionID/abort",
      describeRoute({
        summary: "Abort session",
        description: "Abort an active session and stop any ongoing AI processing or command execution.",
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
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        SessionPrompt.cancel(c.req.valid("param").sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/share",
      describeRoute({
        summary: "Share session",
        description: "Create a shareable link for a session, allowing others to view the conversation.",
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
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.share(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .get(
      "/:sessionID/diff",
      describeRoute({
        summary: "Get message diff",
        description: "Get the file changes (diff) that resulted from a specific user message in the session.",
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
          sessionID: SessionSummary.diff.schema.shape.sessionID,
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
          sessionID: params.sessionID,
          messageID: query.messageID,
        })
        return c.json(result)
      },
    )
    .delete(
      "/:sessionID/share",
      describeRoute({
        summary: "Unshare session",
        description: "Remove the shareable link for a session, making it private again.",
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
          sessionID: Session.unshare.schema,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await Session.unshare(sessionID)
        const session = await Session.get(sessionID)
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/summarize",
      describeRoute({
        summary: "Summarize session",
        description: "Generate a concise summary of the session using AI compaction to preserve key information.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          providerID: ProviderID.zod,
          modelID: ModelID.zod,
          auto: z.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const session = await Session.get(sessionID)
        await SessionRevert.cleanup(session)
        const msgs = await Session.messages({ sessionID })
        let currentAgent = await Agent.defaultAgent()
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            currentAgent = info.agent || (await Agent.defaultAgent())
            break
          }
        }
        await SessionCompaction.create({
          sessionID,
          agent: currentAgent,
          model: {
            providerID: body.providerID,
            modelID: body.modelID,
          },
          auto: body.auto,
        })
        await SessionPrompt.loop({ sessionID })
        return c.json(true)
      },
    )
    .get(
      "/:sessionID/message",
      describeRoute({
        summary: "Get session messages",
        description: "Retrieve all messages in a session, including user prompts and AI responses.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z
          .object({
            limit: z.coerce
              .number()
              .int()
              .min(0)
              .optional()
              .meta({ description: "Maximum number of messages to return" }),
            before: z
              .string()
              .optional()
              .meta({ description: "Opaque cursor for loading older messages" })
              .refine(
                (value) => {
                  if (!value) return true
                  try {
                    MessageV2.cursor.decode(value)
                    return true
                  } catch {
                    return false
                  }
                },
                { message: "Invalid cursor" },
              ),
          })
          .refine((value) => !value.before || value.limit !== undefined, {
            message: "before requires limit",
            path: ["before"],
          }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const sessionID = c.req.valid("param").sessionID
        if (query.limit === undefined) {
          await Session.get(sessionID)
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
        }

        if (query.limit === 0) {
          await Session.get(sessionID)
          return c.json([])
        }

        const page = await MessageV2.page({
          sessionID,
          limit: query.limit,
          before: query.before,
        })
        if (page.cursor) {
          const url = new URL(c.req.url)
          url.searchParams.set("limit", query.limit.toString())
          url.searchParams.set("before", page.cursor)
          c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
          c.header("Link", `<${url.toString()}>; rel=\"next\"`)
          c.header("X-Next-Cursor", page.cursor)
        }
        return c.json(page.items)
      },
    )
    .get(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Get message",
        description: "Retrieve a specific message from a session by its message ID.",
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
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const message = await MessageV2.get({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .delete(
      "/:sessionID/message/:messageID",
      describeRoute({
        summary: "Delete message",
        description:
          "Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.",
        operationId: "session.deleteMessage",
        responses: {
          200: {
            description: "Successfully deleted message",
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
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        SessionPrompt.assertNotBusy(params.sessionID)
        await Session.removeMessage({
          sessionID: params.sessionID,
          messageID: params.messageID,
        })
        return c.json(true)
      },
    )
    .delete(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Delete a part from a message",
        operationId: "part.delete",
        responses: {
          200: {
            description: "Successfully deleted part",
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
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Session.removePart({
          sessionID: params.sessionID,
          messageID: params.messageID,
          partID: params.partID,
        })
        return c.json(true)
      },
    )
    .patch(
      "/:sessionID/message/:messageID/part/:partID",
      describeRoute({
        description: "Update a part in a message",
        operationId: "part.update",
        responses: {
          200: {
            description: "Successfully updated part",
            content: {
              "application/json": {
                schema: resolver(MessageV2.Part),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          messageID: MessageID.zod,
          partID: PartID.zod,
        }),
      ),
      validator("json", MessageV2.Part),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
          return c.text(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
            400,
          )
        }
        const part = await Session.updatePart(body)
        return c.json(part)
      },
    )
    .post(
      "/:sessionID/message",
      describeRoute({
        summary: "Send message",
        description: "Create and send a new message to a session, streaming the AI response.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          const msg = await SessionPrompt.prompt({ ...body, sessionID })
          stream.write(JSON.stringify(msg))
        })
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "session.prompt_async",
        responses: {
          204: {
            description: "Prompt accepted",
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
      async (c) => {
        c.status(204)
        c.header("Content-Type", "application/json")
        return stream(c, async () => {
          const sessionID = c.req.valid("param").sessionID
          const body = c.req.valid("json")
          SessionPrompt.prompt({ ...body, sessionID }).catch((err) => {
            log.error("prompt_async failed", { sessionID, error: err })
            Bus.publish(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({ message: err instanceof Error ? err.message : String(err) }).toObject(),
            })
          })
        })
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.command({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/shell",
      describeRoute({
        summary: "Run shell command",
        description: "Execute a shell command within the session context and return the AI's response.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.shell({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/revert",
      describeRoute({
        summary: "Revert message",
        description: "Revert a specific message in a session, undoing its effects and restoring the previous state.",
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
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        log.info("revert", c.req.valid("json"))
        const session = await SessionRevert.revert({
          sessionID,
          ...c.req.valid("json"),
        })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/unrevert",
      describeRoute({
        summary: "Restore reverted messages",
        description: "Restore all previously reverted messages in a session.",
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
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await SessionRevert.unrevert({ sessionID })
        return c.json(session)
      },
    )
    .post(
      "/:sessionID/permissions/:permissionID",
      describeRoute({
        summary: "Respond to permission",
        deprecated: true,
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.respond",
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
          sessionID: SessionID.zod,
          permissionID: PermissionID.zod,
        }),
      ),
      validator("json", z.object({ response: Permission.Reply })),
      async (c) => {
        const params = c.req.valid("param")
        Permission.reply({
          requestID: params.permissionID,
          reply: c.req.valid("json").response,
        })
        return c.json(true)
      },
    )
    // oc exec: AI judgment via child session
    .post(
      "/:sessionID/exec",
      describeRoute({
        summary: "Execute AI prompt",
        description:
          "Create a child session, send a prompt, wait for the AI response, and return the assistant's text. Designed for bash script callbacks via the oc CLI.",
        operationId: "session.exec",
        responses: {
          200: {
            description: "AI response as plain text",
            content: { "text/plain": { schema: resolver(z.string()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          prompt: z.string().describe("The prompt text to send to the AI"),
          system: z.string().optional().describe("Custom system prompt for specialist creation"),
          agent: z.string().optional().describe("Agent type"),
          model: z.object({ providerID: ProviderID.zod, modelID: ModelID.zod }).optional().describe("Model override"),
          files: z
            .array(z.object({ filename: z.string(), mime: z.string(), url: z.string() }))
            .optional()
            .describe("File attachments (PDFs, images) for multimodal prompts"),
          format: z
            .object({ type: z.literal("json_schema"), schema: z.record(z.string(), z.unknown()) })
            .optional()
            .describe("Force structured output via StructuredOutput tool (e.g. for oc check boolean)"),
          messageID: z.string().optional().describe("Parent message ID — creates visual ToolPart when present"),
        }),
      ),
      async (c) => {
        const parent = c.req.valid("param").sessionID
        const body = c.req.valid("json")

        // Detect oc command in script to disable provider timeout (any long-running operation)
        const noTimeout = c.req.header("x-opencode-no-timeout") === "true"

        await Session.get(parent)

        // Inherit model from parent session if not explicitly provided
        const model = await (async () => {
          if (body.model) return body.model
          const msgs = await Session.messages({ sessionID: parent })
          for (let i = msgs.length - 1; i >= 0; i--) {
            const info = msgs[i].info
            if (info.role === "user" && info.model) return info.model
          }
        })()

        const child = await Session.create({
          parentID: parent,
          title: body.system ? `oc prompt -s "${body.system}"` : "oc prompt",
        })
        const cleanup = () => SessionPrompt.cancel(child.id)
        if (c.req.raw.signal.aborted) {
          cleanup()
          return c.text("aborted", 503)
        }
        c.req.raw.signal.addEventListener("abort", cleanup)

        // Create task ToolPart for subagent visibility (opt-in via messageID)
        const mid = body.messageID ? MessageID.make(body.messageID) : undefined
        const pid = mid ? PartID.ascending() : undefined
        const t0 = Date.now()
        const preview = body.prompt.substring(0, 80) + (body.prompt.length > 80 ? "..." : "")
        const title = body.system ? `oc prompt -s "${body.system}"` : "oc prompt"

        const emit = (state: z.infer<typeof MessageV2.ToolState>) =>
          mid && pid
            ? Session.updatePart({
                id: pid,
                messageID: mid,
                sessionID: parent,
                type: "tool",
                tool: "task",
                callID: pid,
                metadata: { oc: true },
                state,
              })
            : undefined

        await emit({
          status: "running",
          input: { prompt: preview, description: preview, subagent_type: "oc" },
          title,
          metadata: { sessionId: child.id, model },
          time: { start: t0 },
        })

        c.status(200)
        c.header("Content-Type", "text/plain")
        return stream(c, async (stream) => {
          let delta = ""
          const unsub =
            mid && pid
              ? Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
                  if (event.properties.sessionID === child.id && event.properties.field === "text") {
                    delta += event.properties.delta
                    emit({
                      status: "running",
                      input: { prompt: preview },
                      title,
                      metadata: { sessionId: child.id, model, output: delta.substring(0, 2000) },
                      time: { start: t0 },
                    })?.catch(() => {})
                  }
                })
              : undefined

          // Send periodic keepalive to prevent HTTP idle timeout (child sessions can take hours).
          // Use \x00OC_KEEPALIVE\x00 — a null-byte delimited marker that oc.ts strips before
          // returning the response, so it never contaminates the AI text output.
          const KEEPALIVE = "\x00OC_KEEPALIVE\x00"
          const keepalive = setInterval(() => stream.write(KEEPALIVE).catch(() => {}), 15_000)

          try {
            const parts: Parameters<typeof SessionPrompt.prompt>[0]["parts"] = [{ type: "text", text: body.prompt }]
            if (body.files?.length) {
              for (const file of body.files) {
                parts.push({ type: "file", mime: file.mime, url: file.url, filename: file.filename })
              }
            }
            const msg = await SessionPrompt.prompt({
              sessionID: child.id,
              parts,
              system: body.system,
              agent: body.agent,
              model,
              format: body.format ? { ...body.format, retryCount: 3 } : undefined,
              noTimeout,
            })
            const out =
              body.format && msg.info.role === "assistant" && msg.info.structured !== undefined
                ? JSON.stringify(msg.info.structured)
                : ((msg.parts.findLast((p) => p.type === "text") as { type: "text"; text: string } | undefined)?.text ??
                  "")

            await emit({
              status: "completed",
              input: { prompt: preview },
              output: out.substring(0, 2000),
              title,
              metadata: { sessionId: child.id, model },
              time: { start: t0, end: Date.now() },
            })
            await stream.write(out)
          } catch (error) {
            await emit({
              status: "error",
              input: { prompt: preview },
              error: error instanceof Error ? error.message : String(error),
              time: { start: t0, end: Date.now() },
            })
            throw error
          } finally {
            clearInterval(keepalive)
            unsub?.()
            c.req.raw.signal.removeEventListener("abort", cleanup)
          }
        })
      },
    )
    // oc tool: Direct tool execution — no LLM, deterministic
    .post(
      "/:sessionID/tool",
      describeRoute({
        summary: "Execute tool directly",
        description:
          "Execute an openCode tool directly without LLM involvement. Deterministic operations from bash scripts via the oc CLI.",
        operationId: "session.tool",
        responses: {
          200: {
            description: "Tool output as plain text",
            content: { "text/plain": { schema: resolver(z.string()) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          name: z.string().describe("Tool name (e.g. read, edit, grep, glob)"),
          args: z.record(z.string(), z.unknown()).describe("Tool arguments"),
          agent: z.string().optional().describe("Agent context for permissions"),
          messageID: z.string().optional().describe("Parent message ID — creates visual ToolParts when present"),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        const tools = await ToolRegistry.tools({ providerID: ProviderID.make(""), modelID: ModelID.make("") })
        const tool = tools.find((t) => t.id === body.name)
        if (!tool) return c.text(`Tool not found: ${body.name}`, 404)

        const session = await Session.get(param.sessionID)
        const agent = body.agent ?? "build"
        const ag = await Agent.get(agent)

        const mid = body.messageID ? MessageID.make(body.messageID) : undefined
        const pid = mid ? PartID.ascending() : undefined
        const t0 = Date.now()

        const emit = (state: z.infer<typeof MessageV2.ToolState>) =>
          mid && pid
            ? Session.updatePart({
                id: pid,
                messageID: mid,
                sessionID: param.sessionID,
                type: "tool",
                tool: body.name,
                callID: pid,
                metadata: { oc: true },
                state,
              })
            : undefined

        await emit({ status: "running", input: body.args, time: { start: t0 } })

        const ctx = {
          sessionID: param.sessionID,
          messageID: mid ?? MessageID.ascending(),
          callID: pid ?? PartID.ascending(),
          agent,
          abort: c.req.raw.signal,
          messages: [] as MessageV2.WithParts[],
          metadata: async (val: { title?: string; metadata?: Record<string, unknown> }) => {
            await emit({
              status: "running",
              input: body.args,
              title: val.title,
              metadata: val.metadata,
              time: { start: t0 },
            })
          },
          async ask(req: Omit<Permission.Request, "id" | "sessionID" | "tool">) {
            await Permission.ask({
              ...req,
              sessionID: param.sessionID,
              ruleset: Permission.merge(ag?.permission ?? [], session.permission ?? []),
            })
          },
        }

        c.status(200)
        c.header("Content-Type", "text/plain")
        return stream(c, async (stream) => {
          try {
            const result = await tool.execute(body.args, ctx)
            await emit({
              status: "completed",
              input: body.args,
              output: result.output,
              title: result.title ?? "",
              metadata: result.metadata ?? {},
              time: { start: t0, end: Date.now() },
            })
            await stream.write(
              result.output +
                (result.attachments?.length && body.args?.filePath ? `\n\x00OC_FILE\x00:${body.args.filePath}` : "") +
                (result.metadata?.truncated
                  ? `\n\x00OC_TRUNCATED\x00:Results limited to ${result.metadata.count ?? "unknown"} items. Use a more specific pattern to get all results.`
                  : ""),
            )
          } catch (error) {
            await emit({
              status: "error",
              input: body.args,
              error: error instanceof Error ? error.message : String(error),
              time: { start: t0, end: Date.now() },
            })
            await stream.write(`Error: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
      },
    )
    // POST /session/:id/status — create a visible status ToolPart (used by oc status)
    .post(
      "/:sessionID/status",
      describeRoute({
        summary: "Post status message",
        description: "Create a visible status ToolPart in the session thread. Used by the oc CLI to show progress.",
        operationId: "session.status.post",
        responses: {
          200: { description: "Status accepted", content: { "text/plain": { schema: resolver(z.string()) } } },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator("json", z.object({ message: z.string(), messageID: z.string().optional() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const mid = body.messageID ? MessageID.make(body.messageID) : undefined
        if (mid && body.message) {
          const pid = PartID.ascending()
          await Session.updatePart({
            id: pid,
            messageID: mid,
            sessionID,
            type: "tool",
            tool: "status",
            callID: pid,
            metadata: { oc: true },
            state: {
              status: "completed",
              input: { message: body.message },
              output: body.message,
              title: "",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          })
        }
        return c.text("ok")
      },
    ),
)
