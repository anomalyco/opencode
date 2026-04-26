import * as InstanceState from "@/effect/instance-state"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { Effect, Layer, Schema, Struct } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const root = "/session"
const ListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  roots: Schema.optional(Schema.Literals(["true", "false"])),
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

export const SessionPaths = {
  list: root,
  status: `${root}/status`,
  get: `${root}/:sessionID`,
  children: `${root}/:sessionID/children`,
  todo: `${root}/:sessionID/todo`,
  diff: `${root}/:sessionID/diff`,
  messages: `${root}/:sessionID/message`,
  message: `${root}/:sessionID/message/:messageID`,
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

export const sessionHandlers = Layer.unwrap(
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
            roots: ctx.query.roots === "true" ? true : undefined,
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

    return HttpApiBuilder.group(SessionApi, "session", (handlers) =>
      handlers
        .handle("list", list)
        .handle("status", status)
        .handle("get", get)
        .handle("children", children)
        .handle("todo", todo)
        .handle("diff", diff)
        .handle("messages", messages)
        .handle("message", message),
    )
  }),
).pipe(
  Layer.provide(Session.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
  Layer.provide(Todo.defaultLayer),
  Layer.provide(SessionSummary.defaultLayer),
)
