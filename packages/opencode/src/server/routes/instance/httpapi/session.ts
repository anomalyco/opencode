import * as InstanceState from "@/effect/instance-state"
import { AppRuntime } from "@/effect/app-runtime"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Instance } from "@/project/instance"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import { Effect, Schema, SchemaGetter, Struct } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const log = Log.create({ service: "server" })
const root = "/session"
const QueryBoolean = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)
const ListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["project"])),
  path: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})
const DiffQuery = Schema.Struct(Struct.omit(SessionSummary.DiffInput.fields, ["sessionID"]))
const MessagesQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  before: Schema.optional(Schema.String),
})
const StatusMap = Schema.Record(Schema.String, SessionStatus.Info)
const UpdatePayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  permission: Schema.optional(Permission.Ruleset),
  time: Schema.optional(
    Schema.Struct({
      archived: Schema.optional(Schema.Number),
    }),
  ),
}).annotate({ identifier: "SessionUpdateInput" })
const ForkPayload = Schema.Struct(Struct.omit(Session.ForkInput.fields, ["sessionID"])).annotate({
  identifier: "SessionForkInput",
})
const InitPayload = Schema.Struct({
  modelID: ModelID,
  providerID: ProviderID,
  messageID: MessageID,
}).annotate({ identifier: "SessionInitInput" })
const SummarizePayload = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
  auto: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SessionSummarizeInput" })
const PromptPayload = Schema.Struct(Struct.omit(SessionPrompt.PromptInput.fields, ["sessionID"])).annotate({
  identifier: "SessionPromptInput",
})
const CommandPayload = Schema.Struct(Struct.omit(SessionPrompt.CommandInput.fields, ["sessionID"])).annotate({
  identifier: "SessionCommandInput",
})
const ShellPayload = Schema.Struct(Struct.omit(SessionPrompt.ShellInput.fields, ["sessionID"])).annotate({
  identifier: "SessionShellInput",
})
const RevertPayload = Schema.Struct(Struct.omit(SessionRevert.RevertInput.fields, ["sessionID"])).annotate({
  identifier: "SessionRevertInput",
})
const PermissionResponsePayload = Schema.Struct({
  response: Permission.Reply,
}).annotate({ identifier: "SessionPermissionResponseInput" })

export const SessionPaths = {
  list: root,
  status: `${root}/status`,
  get: `${root}/:sessionID`,
  children: `${root}/:sessionID/children`,
  todo: `${root}/:sessionID/todo`,
  diff: `${root}/:sessionID/diff`,
  messages: `${root}/:sessionID/message`,
  message: `${root}/:sessionID/message/:messageID`,
  create: root,
  remove: `${root}/:sessionID`,
  update: `${root}/:sessionID`,
  fork: `${root}/:sessionID/fork`,
  abort: `${root}/:sessionID/abort`,
  share: `${root}/:sessionID/share`,
  init: `${root}/:sessionID/init`,
  summarize: `${root}/:sessionID/summarize`,
  prompt: `${root}/:sessionID/message`,
  promptAsync: `${root}/:sessionID/prompt_async`,
  command: `${root}/:sessionID/command`,
  shell: `${root}/:sessionID/shell`,
  revert: `${root}/:sessionID/revert`,
  unrevert: `${root}/:sessionID/unrevert`,
  permissions: `${root}/:sessionID/permissions/:permissionID`,
  deleteMessage: `${root}/:sessionID/message/:messageID`,
  deletePart: `${root}/:sessionID/message/:messageID/part/:partID`,
  updatePart: `${root}/:sessionID/message/:messageID/part/:partID`,
} as const

export const SessionApi = HttpApi.make("session")
  .add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("list", SessionPaths.list, {
          query: ListQuery,
          success: Schema.Array(Session.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.list",
            summary: "List sessions",
            description: "Get a list of all OpenCode sessions, sorted by most recently updated.",
          }),
        ),
        HttpApiEndpoint.get("status", SessionPaths.status, {
          success: StatusMap,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.status",
            summary: "Get session status",
            description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
          }),
        ),
        HttpApiEndpoint.get("get", SessionPaths.get, {
          params: { sessionID: SessionID },
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.get",
            summary: "Get session",
            description: "Retrieve detailed information about a specific OpenCode session.",
          }),
        ),
        HttpApiEndpoint.get("children", SessionPaths.children, {
          params: { sessionID: SessionID },
          success: Schema.Array(Session.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.children",
            summary: "Get session children",
            description: "Retrieve all child sessions that were forked from the specified parent session.",
          }),
        ),
        HttpApiEndpoint.get("todo", SessionPaths.todo, {
          params: { sessionID: SessionID },
          success: Schema.Array(Todo.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.todo",
            summary: "Get session todos",
            description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
          }),
        ),
        HttpApiEndpoint.get("diff", SessionPaths.diff, {
          params: { sessionID: SessionID },
          query: DiffQuery,
          success: Schema.Array(Snapshot.FileDiff),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.diff",
            summary: "Get message diff",
            description: "Get the file changes (diff) that resulted from a specific user message in the session.",
          }),
        ),
        HttpApiEndpoint.get("messages", SessionPaths.messages, {
          params: { sessionID: SessionID },
          query: MessagesQuery,
          success: Schema.Array(MessageV2.WithParts),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.messages",
            summary: "Get session messages",
            description: "Retrieve all messages in a session, including user prompts and AI responses.",
          }),
        ),
        HttpApiEndpoint.get("message", SessionPaths.message, {
          params: { sessionID: SessionID, messageID: MessageID },
          success: MessageV2.WithParts,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.message",
            summary: "Get message",
            description: "Retrieve a specific message from a session by its message ID.",
          }),
        ),
        HttpApiEndpoint.post("create", SessionPaths.create, {
          payload: [HttpApiSchema.NoContent, Session.CreateInput],
          success: Session.Info,
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.create",
            summary: "Create session",
            description: "Create a new OpenCode session for interacting with AI assistants and managing conversations.",
          }),
        ),
        HttpApiEndpoint.delete("remove", SessionPaths.remove, {
          params: { sessionID: SessionID },
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.delete",
            summary: "Delete session",
            description: "Delete a session and permanently remove all associated data, including messages and history.",
          }),
        ),
        HttpApiEndpoint.patch("update", SessionPaths.update, {
          params: { sessionID: SessionID },
          payload: UpdatePayload,
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.update",
            summary: "Update session",
            description: "Update properties of an existing session, such as title or other metadata.",
          }),
        ),
        HttpApiEndpoint.post("fork", SessionPaths.fork, {
          params: { sessionID: SessionID },
          payload: ForkPayload,
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.fork",
            summary: "Fork session",
            description: "Create a new session by forking an existing session at a specific message point.",
          }),
        ),
        HttpApiEndpoint.post("abort", SessionPaths.abort, {
          params: { sessionID: SessionID },
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.abort",
            summary: "Abort session",
            description: "Abort an active session and stop any ongoing AI processing or command execution.",
          }),
        ),
        HttpApiEndpoint.post("init", SessionPaths.init, {
          params: { sessionID: SessionID },
          payload: InitPayload,
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.init",
            summary: "Initialize session",
            description:
              "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
          }),
        ),
        HttpApiEndpoint.post("share", SessionPaths.share, {
          params: { sessionID: SessionID },
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.share",
            summary: "Share session",
            description: "Create a shareable link for a session, allowing others to view the conversation.",
          }),
        ),
        HttpApiEndpoint.delete("unshare", SessionPaths.share, {
          params: { sessionID: SessionID },
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unshare",
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
          }),
        ),
        HttpApiEndpoint.post("summarize", SessionPaths.summarize, {
          params: { sessionID: SessionID },
          payload: SummarizePayload,
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.summarize",
            summary: "Summarize session",
            description: "Generate a concise summary of the session using AI compaction to preserve key information.",
          }),
        ),
        HttpApiEndpoint.post("prompt", SessionPaths.prompt, {
          params: { sessionID: SessionID },
          payload: PromptPayload,
          success: MessageV2.WithParts,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt",
            summary: "Send message",
            description: "Create and send a new message to a session, streaming the AI response.",
          }),
        ),
        HttpApiEndpoint.post("promptAsync", SessionPaths.promptAsync, {
          params: { sessionID: SessionID },
          payload: PromptPayload,
          success: HttpApiSchema.NoContent,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt_async",
            summary: "Send async message",
            description:
              "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
          }),
        ),
        HttpApiEndpoint.post("command", SessionPaths.command, {
          params: { sessionID: SessionID },
          payload: CommandPayload,
          success: MessageV2.WithParts,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.command",
            summary: "Send command",
            description: "Send a new command to a session for execution by the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("shell", SessionPaths.shell, {
          params: { sessionID: SessionID },
          payload: ShellPayload,
          success: MessageV2.WithParts,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.shell",
            summary: "Run shell command",
            description: "Execute a shell command within the session context and return the AI's response.",
          }),
        ),
        HttpApiEndpoint.post("revert", SessionPaths.revert, {
          params: { sessionID: SessionID },
          payload: RevertPayload,
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.revert",
            summary: "Revert message",
            description:
              "Revert a specific message in a session, undoing its effects and restoring the previous state.",
          }),
        ),
        HttpApiEndpoint.post("unrevert", SessionPaths.unrevert, {
          params: { sessionID: SessionID },
          success: Session.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unrevert",
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
          }),
        ),
        HttpApiEndpoint.post("permissionRespond", SessionPaths.permissions, {
          params: { sessionID: SessionID, permissionID: PermissionID },
          payload: PermissionResponsePayload,
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.respond",
            summary: "Respond to permission",
            description: "Approve or deny a permission request from the AI assistant.",
            deprecated: true,
          }),
        ),
        HttpApiEndpoint.delete("deleteMessage", SessionPaths.deleteMessage, {
          params: { sessionID: SessionID, messageID: MessageID },
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.deleteMessage",
            summary: "Delete message",
            description:
              "Permanently delete a specific message and all of its parts from a session without reverting file changes.",
          }),
        ),
        HttpApiEndpoint.delete("deletePart", SessionPaths.deletePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.delete",
            description: "Delete a part from a message.",
          }),
        ),
        HttpApiEndpoint.patch("updatePart", SessionPaths.updatePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          payload: MessageV2.Part,
          success: MessageV2.Part,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.update",
            description: "Update a part in a message.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "session",
          description: "Experimental HttpApi session routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const sessionHandlers = HttpApiBuilder.group(SessionApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const instance = yield* InstanceState.context
      return Instance.restore(instance, () =>
        Array.from(
          Session.list({
            directory: ctx.query.directory,
            scope: ctx.query.scope,
            path: ctx.query.path,
            roots: ctx.query.roots,
            start: ctx.query.start,
            search: ctx.query.search,
            limit: ctx.query.limit,
          }),
        ),
      )
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* session.get(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        yield* session.get(ctx.params.sessionID)
        return yield* session.messages({ sessionID: ctx.params.sessionID })
      }

      const page = MessageV2.page({
        sessionID: ctx.params.sessionID,
        limit: ctx.query.limit,
        before: ctx.query.before,
      })
      if (!page.cursor) return page.items

      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://localhost")
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* Effect.sync(() =>
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionShare.Service.use((svc) => svc.create(ctx.payload)).pipe(Effect.provide(SessionShare.defaultLayer)),
          ),
        ),
      )
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => new HttpApiError.BadRequest({}),
      })
      const payload = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) => svc.remove(ctx.params.sessionID)).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) =>
              Effect.gen(function* () {
                const current = yield* svc.get(ctx.params.sessionID)
                if (ctx.payload.title !== undefined) {
                  yield* svc.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
                }
                if (ctx.payload.permission !== undefined) {
                  yield* svc.setPermission({
                    sessionID: ctx.params.sessionID,
                    permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
                  })
                }
                if (ctx.payload.time?.archived !== undefined) {
                  yield* svc.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
                }
                return yield* svc.get(ctx.params.sessionID)
              }),
            ).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ForkPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) =>
              svc.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload.messageID }),
            ).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) => svc.cancel(ctx.params.sessionID)).pipe(
              Effect.provide(SessionPrompt.defaultLayer),
            ),
          ),
        ),
      )
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.command({
                sessionID: ctx.params.sessionID,
                messageID: ctx.payload.messageID,
                model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
                command: Command.Default.INIT,
                arguments: "",
              }),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const share = yield* SessionShare.Service
              const session = yield* Session.Service
              yield* share.share(ctx.params.sessionID)
              return yield* session.get(ctx.params.sessionID)
            }).pipe(Effect.provide(SessionShare.defaultLayer)),
          ),
        ),
      )
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const share = yield* SessionShare.Service
              const session = yield* Session.Service
              yield* share.unshare(ctx.params.sessionID)
              return yield* session.get(ctx.params.sessionID)
            }).pipe(Effect.provide(SessionShare.defaultLayer)),
          ),
        ),
      )
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const session = yield* Session.Service
              const revert = yield* SessionRevert.Service
              const compact = yield* SessionCompaction.Service
              const prompt = yield* SessionPrompt.Service
              const agent = yield* Agent.Service

              yield* revert.cleanup(yield* session.get(ctx.params.sessionID))
              const messages = yield* session.messages({ sessionID: ctx.params.sessionID })
              const defaultAgent = yield* agent.defaultAgent()
              const currentAgent =
                messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

              yield* compact.create({
                sessionID: ctx.params.sessionID,
                agent: currentAgent,
                model: {
                  providerID: ctx.payload.providerID,
                  modelID: ctx.payload.modelID,
                },
                auto: ctx.payload.auto ?? false,
              })
              yield* prompt.loop({ sessionID: ctx.params.sessionID })
            }).pipe(
              Effect.provide(SessionRevert.defaultLayer),
              Effect.provide(SessionCompaction.defaultLayer),
              Effect.provide(SessionPrompt.defaultLayer),
              Effect.provide(Agent.defaultLayer),
              Effect.provide(Session.defaultLayer),
            ),
          ),
        ),
      )
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return HttpServerResponse.stream(
        Stream.fromEffect(
          Effect.promise(() =>
            Instance.restore(instance, () =>
              AppRuntime.runPromise(
                SessionPrompt.Service.use((svc) =>
                  svc.prompt({
                    ...ctx.payload,
                    sessionID: ctx.params.sessionID,
                  } as unknown as SessionPrompt.PromptInput),
                ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
              ),
            ),
          ),
        ).pipe(
          Stream.map((message) => JSON.stringify(message)),
          Stream.encodeText,
        ),
        { contentType: "application/json" },
      )
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.sync(() => {
        Instance.restore(instance, () => {
          void AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID } as unknown as SessionPrompt.PromptInput),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ).catch((error) => {
            log.error("prompt_async failed", { sessionID: ctx.params.sessionID, error })
            void Bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({
                message: error instanceof Error ? error.message : String(error),
              }).toObject(),
            })
          })
        })
      })
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.command({ ...ctx.payload, sessionID: ctx.params.sessionID } as SessionPrompt.CommandInput),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ),
        ),
      )
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionPrompt.Service.use((svc) =>
              svc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID } as SessionPrompt.ShellInput),
            ).pipe(Effect.provide(SessionPrompt.defaultLayer)),
          ),
        ),
      )
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      const instance = yield* InstanceState.context
      log.info("revert", ctx.payload)
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionRevert.Service.use((svc) => svc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload })).pipe(
              Effect.provide(SessionRevert.defaultLayer),
            ),
          ),
        ),
      )
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            SessionRevert.Service.use((svc) => svc.unrevert({ sessionID: ctx.params.sessionID })).pipe(
              Effect.provide(SessionRevert.defaultLayer),
            ),
          ),
        ),
      )
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Permission.Service.use((svc) =>
              svc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }),
            ).pipe(Effect.provide(Permission.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Effect.gen(function* () {
              const state = yield* SessionRunState.Service
              const session = yield* Session.Service
              yield* state.assertNotBusy(ctx.params.sessionID)
              yield* session.removeMessage(ctx.params)
            }).pipe(Effect.provide(SessionRunState.defaultLayer), Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      const instance = yield* InstanceState.context
      yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) => svc.removePart(ctx.params)).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        throw new Error(
          `Part mismatch: body.id='${payload.id}' vs partID='${ctx.params.partID}', body.messageID='${payload.messageID}' vs messageID='${ctx.params.messageID}', body.sessionID='${payload.sessionID}' vs sessionID='${ctx.params.sessionID}'`,
        )
      }
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        Instance.restore(instance, () =>
          AppRuntime.runPromise(
            Session.Service.use((svc) => svc.updatePart(payload)).pipe(Effect.provide(Session.defaultLayer)),
          ),
        ),
      )
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handle("fork", fork)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
