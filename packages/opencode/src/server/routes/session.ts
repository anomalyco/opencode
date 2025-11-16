import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { stream } from "hono/streaming"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionLock } from "../../session/lock"
import { SessionPrompt } from "../../session/prompt"
import { SessionCompaction } from "../../session/compaction"
import { SessionRevert } from "../../session/revert"
import { Permission } from "../../permission"
import { Todo } from "../../session/todo"
import { Bus } from "../../bus"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "@/session/summary"
import { errors } from "./shared"

export function sessionRoutes() {
  const router = new Hono()

  router
    .get(
      "/",
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
      "/:id",
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
      "/:id/children",
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
      "/:id/todo",
      describeRoute({
        description: "Get the todo list for a session",
        operationId: "session.getTodo",
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
      "/:id/todo",
      describeRoute({
        description: "Update the todo list for a session",
        operationId: "session.updateTodo",
        responses: {
          200: {
            description: "Updated todo list",
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
      validator(
        "json",
        z.object({
          todos: Todo.Info.array(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").id
        const { todos } = c.req.valid("json")
        await Todo.update({ sessionID, todos })
        return c.json(todos)
      },
    )
    .post(
      "/",
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
      "/:id",
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
      "/:id",
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
      "/:id/init",
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
      "/:id/fork",
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
      "/:id/abort",
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
      "/:id/share",
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
      "/:id/diff",
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
          messageID: SessionSummary.diff.schema.shape.messageID.optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const params = c.req.valid("param")
        if (query.messageID) {
          const result = await SessionSummary.diff({
            sessionID: params.id,
            messageID: query.messageID,
          })
          return c.json(result)
        }
        const diff = await Session.diff(params.id)
        return c.json(diff)
      },
    )
    .delete(
      "/:id/share",
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
      "/:id/summarize",
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
      "/:id/message",
      describeRoute({
        description: "List messages for a session with optional pagination",
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
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const messages = await Session.messages({
          sessionID: c.req.valid("param").id,
          limit: query.limit,
        })
        return c.json(messages)
      },
    )
    .get(
      "/:id/message/:messageID",
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
        const message = await MessageV2.get({
          sessionID: params.id,
          messageID: params.messageID,
        })
        return c.json(message)
      },
    )
    .patch(
      "/:id/message/:messageID/priority",
      describeRoute({
        description: "Set priority level for a message",
        operationId: "session.setMessagePriority",
        responses: {
          200: {
            description: "Updated message info",
            content: {
              "application/json": {
                schema: resolver(MessageV2.Info),
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
      validator(
        "json",
        z.object({
          priority: z.enum(["red", "amber", "green", "none"]),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        const updated = await Session.setMessagePriority({
          sessionID: params.id,
          messageID: params.messageID,
          priority: body.priority,
        })
        return c.json(updated)
      },
    )
    .post(
      "/:id/message/:messageID/compact",
      describeRoute({
        description: "Summarize and compact a single message",
        operationId: "session.compactMessage",
        responses: {
          200: {
            description: "Updated message info",
            content: {
              "application/json": {
                schema: resolver(MessageV2.Info),
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
        const info = await SessionCompaction.compactMessage({
          sessionID: params.id,
          messageID: params.messageID,
        })
        return c.json(info)
      },
    )
    .post(
      "/:id/message",
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
      "/:id/command",
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
      "/:id/shell",
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
      "/:id/revert",
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
        const session = await SessionRevert.revert({
          sessionID: id,
          ...c.req.valid("json"),
        })
        return c.json(session)
      },
    )
    .post(
      "/:id/unrevert",
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
      "/:id/permissions/:permissionID",
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

  return router
}
