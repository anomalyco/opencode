import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Effect } from "effect"
import { SessionID, MessageID, PartID } from "@/session/schema"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { SessionRunState } from "@/session/run-state"
import { SessionCompaction } from "../../session/compaction"
import { SessionRevert } from "../../session/revert"
import { SessionShare } from "@/share/session"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "../../session/todo"
import { SessionPending } from "../../session/pending"
import { AppRuntime } from "../../effect/app-runtime"
import { Agent } from "../../agent/agent"
import { Snapshot } from "@/snapshot"
import { Command } from "../../command"
import { Log } from "../../util/log"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { errors, STEER_UNAVAILABLE_ERROR } from "../error"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

const ensureHistoryMutationAllowed = (pending: SessionPending.Info, sessionID: SessionID) => {
  if (pending.steer.length === 0 && pending.queue.length === 0) return
  throw new SessionPending.ConflictError({
    sessionID,
    message: "Resolve or resume pending follow-ups before mutating history",
  })
}

const runHistoryMutationWithPendingLock = async <T>(sessionID: SessionID, task: () => Promise<T>) =>
  AppRuntime.runPromise(
    SessionPending.Service.use((svc) =>
      svc.withLock(
        sessionID,
        svc.get(sessionID).pipe(
          Effect.flatMap((pending) => {
            return SessionRunState.Service.use((runState) => runState.isStopRequested(sessionID)).pipe(
              Effect.flatMap((stopRequested) => {
                if (stopRequested) {
                  throw new SessionPending.ConflictError({
                    sessionID,
                    message: "Stop is still in progress",
                  })
                }
                ensureHistoryMutationAllowed(pending, sessionID)
                return Effect.tryPromise({
                  try: task,
                  catch: (error) => error,
                })
              }),
            )
          }),
        ),
      ),
    ),
  )

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
        const result = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.list()))
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
        const todos = await AppRuntime.runPromise(Todo.Service.use((svc) => svc.get(sessionID)))
        return c.json(todos)
      },
    )
    .get(
      "/:sessionID/pending",
      describeRoute({
        summary: "Get pending follow-ups",
        description: "Retrieve the server-owned pending steer and queue lanes for a session.",
        operationId: "session.pending",
        responses: {
          200: {
            description: "Pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
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
        await Session.get(sessionID)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(sessionID)))
        return c.json(pending)
      },
    )
    .post(
      "/:sessionID/pending",
      describeRoute({
        summary: "Add pending follow-up",
        description: "Create a new pending follow-up in the steer or queue lane for a session.",
        operationId: "session.pending_add",
        requestBody: {
          required: true,
          content: {},
        },
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          400: STEER_UNAVAILABLE_ERROR,
          ...errors(404, 409),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator("json", SessionPending.AddInput.omit({ sessionID: true })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await Session.get(sessionID)
        const pending = await AppRuntime.runPromise(
          SessionPending.Service.use((pendingSvc) =>
            pendingSvc.addResolved({
              ...body,
              sessionID,
              resolveDraft: SessionPrompt.Service.use((promptSvc) =>
                promptSvc.snapshotPendingDraft(sessionID, body.draft),
              ),
            }),
          ),
        )
        await SessionPrompt.activatePending(sessionID)
        return c.json(pending)
      },
    )
    .delete(
      "/:sessionID/pending/:itemID",
      describeRoute({
        summary: "Delete pending follow-up",
        description: "Delete a pending follow-up item from either lane.",
        operationId: "session.pending_delete",
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", SessionPending.ItemInput),
      async (c) => {
        const params = c.req.valid("param")
        await Session.get(params.sessionID)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.remove(params)))
        return c.json(pending)
      },
    )
    .post(
      "/:sessionID/pending/:itemID/move_up",
      describeRoute({
        summary: "Move pending item up",
        description: "Move a pending follow-up one slot earlier inside its current lane.",
        operationId: "session.pending_move_up",
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", SessionPending.ItemInput),
      async (c) => {
        const params = c.req.valid("param")
        await Session.get(params.sessionID)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.moveUp(params)))
        return c.json(pending)
      },
    )
    .post(
      "/:sessionID/pending/:itemID/move_down",
      describeRoute({
        summary: "Move pending item down",
        description: "Move a pending follow-up one slot later inside its current lane.",
        operationId: "session.pending_move_down",
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", SessionPending.ItemInput),
      async (c) => {
        const params = c.req.valid("param")
        await Session.get(params.sessionID)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.moveDown(params)))
        return c.json(pending)
      },
    )
    .post(
      "/:sessionID/pending/:itemID/move_lane",
      describeRoute({
        summary: "Move pending item between lanes",
        description: "Move a pending follow-up between the queue and steer lanes.",
        operationId: "session.pending_move_lane",
        requestBody: {
          required: true,
          content: {},
        },
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          400: STEER_UNAVAILABLE_ERROR,
          ...errors(404, 409),
        },
      }),
      validator("param", SessionPending.ItemInput),
      validator("json", z.object({ lane: SessionPending.Lane })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        await Session.get(params.sessionID)
        const pending = await AppRuntime.runPromise(
          SessionPending.Service.use((svc) => svc.moveLane({ ...params, lane: body.lane })),
        )
        if (body.lane === "queue" && pending.queue.some((item) => item.id === params.itemID)) {
          await SessionPrompt.activatePending(params.sessionID)
        }
        return c.json(pending)
      },
    )
    .post(
      "/:sessionID/pending/:itemID/edit_commit",
      describeRoute({
        summary: "Save edits to a pending follow-up",
        description: "Replace a pending follow-up draft.",
        operationId: "session.pending_edit_commit",
        requestBody: {
          required: true,
          content: {},
        },
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      validator("param", SessionPending.ItemInput),
      validator("json", z.object({ draft: SessionPending.Draft })),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        await Session.get(params.sessionID)
        const pending = await AppRuntime.runPromise(
          SessionPending.Service.use((pendingSvc) =>
            pendingSvc.commitEditResolved({
              ...params,
              resolveDraft: SessionPrompt.Service.use((promptSvc) =>
                promptSvc.snapshotPendingDraft(params.sessionID, body.draft),
              ),
            }),
          ),
        )
        return c.json(pending)
      },
    )
    .post(
      "/:sessionID/pending/resume",
      describeRoute({
        summary: "Resume pending follow-ups",
        description: "Explicitly resume paused pending follow-ups.",
        operationId: "session.pending_resume",
        responses: {
          200: {
            description: "Updated pending follow-up state",
            content: {
              "application/json": {
                schema: resolver(SessionPending.Info),
              },
            },
          },
          ...errors(400, 404, 409),
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
        await Session.get(sessionID)
        const pending = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.resume(sessionID)))
        await SessionPrompt.activatePending(sessionID)
        return c.json(pending)
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
      validator("json", Session.create.schema),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const session = await SessionShare.create(body)
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
    // TODO(v2): remove this dedicated route and rely on the normal `/init` command flow.
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
      validator(
        "json",
        z.object({
          modelID: ModelID.zod,
          providerID: ProviderID.zod,
          messageID: MessageID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await SessionPrompt.command({
          sessionID,
          messageID: body.messageID,
          model: body.providerID + "/" + body.modelID,
          command: Command.Default.INIT,
          arguments: "",
        })
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
        const sessionID = c.req.valid("param").sessionID
        await Session.get(sessionID)
        await SessionPrompt.cancel(sessionID)
        return c.json(true)
      },
    )
    .post(
      "/:sessionID/stop",
      describeRoute({
        summary: "Stop session",
        description:
          "Stop an active session, promote steer follow-ups to queued work, and pause pending follow-ups until resumed.",
        operationId: "session.stop",
        responses: {
          200: {
            description: "Stopped session",
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
        const sessionID = c.req.valid("param").sessionID
        await Session.get(sessionID)
        const shouldStop = await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.requestStop(sessionID)))
        const foregroundStarting = await SessionPrompt.isForegroundStarting(sessionID)
        const pendingInfo = await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.get(sessionID)))
        const shouldPauseScheduler =
          pendingInfo.paused ||
          pendingInfo.steer.length > 0 ||
          pendingInfo.queue.length > 0
        if (!shouldStop && !foregroundStarting && !shouldPauseScheduler) {
          await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.finishStop(sessionID)))
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.refresh(sessionID)))
          return c.json(true)
        }
        let beganStop = false
        try {
          await AppRuntime.runPromise(
            SessionPending.Service.use((svc) => svc.beginStop(sessionID)),
          )
          beganStop = true
          if (shouldStop || foregroundStarting) await SessionPrompt.cancel(sessionID)
        } finally {
          if (beganStop) {
            await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.finishStop(sessionID))).catch(() => {})
          }
          await AppRuntime.runPromise(SessionRunState.Service.use((svc) => svc.finishStop(sessionID)))
          await AppRuntime.runPromise(SessionPending.Service.use((svc) => svc.refresh(sessionID))).catch(() => {})
        }
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
        await SessionShare.share(sessionID)
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
          sessionID: SessionSummary.DiffInput.shape.sessionID,
        }),
      ),
      validator(
        "query",
        z.object({
          messageID: SessionSummary.DiffInput.shape.messageID,
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
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        await SessionShare.unshare(sessionID)
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
          const messages = await Session.messages({ sessionID })
          return c.json(messages)
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
        await SessionRunState.assertNotBusy(params.sessionID)
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
          throw new Error(
            `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
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
        requestBody: {
          required: true,
          content: {},
        },
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
          ...errors(400, 404, 409),
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
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.prompt({ ...body, sessionID })
        return c.json(msg)
      },
    )
    .post(
      "/:sessionID/prompt_async",
      describeRoute({
        summary: "Send async message",
        description:
          "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
        operationId: "session.prompt_async",
        requestBody: {
          required: true,
          content: {},
        },
        responses: {
          204: {
            description: "Prompt accepted",
          },
          ...errors(400, 404, 409),
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
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        await AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.promptAsync({ ...body, sessionID })))
        return c.body(null, 204)
      },
    )
    .post(
      "/:sessionID/command",
      describeRoute({
        summary: "Send command",
        description: "Send a new command to a session for execution by the AI assistant.",
        operationId: "session.command",
        requestBody: {
          required: true,
          content: {},
        },
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
          ...errors(400, 404, 409),
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
                schema: resolver(MessageV2.WithParts),
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
        requestBody: {
          required: true,
          content: {},
        },
        responses: {
          200: {
            description: "Updated session",
            content: {
              "application/json": {
                schema: resolver(Session.Info),
              },
            },
          },
          ...errors(400, 404, 409),
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
        const session = await runHistoryMutationWithPendingLock(sessionID, () =>
          SessionRevert.revert({
            sessionID,
            ...c.req.valid("json"),
          }),
        )
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
          ...errors(400, 404, 409),
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
        const session = await runHistoryMutationWithPendingLock(sessionID, () => SessionRevert.unrevert({ sessionID }))
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
    ),
)
