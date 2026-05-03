import { WorkspaceID } from "@/control-plane/schema"
import { SessionV2 } from "@/v2/session"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

const DefaultSessionsLimit = 50

const SessionCursor = Schema.Struct({
  id: SessionV2.Info.fields.id,
  time: Schema.Finite,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
  directory: Schema.String.pipe(Schema.optional),
  path: Schema.String.pipe(Schema.optional),
  workspaceID: WorkspaceID.pipe(Schema.optional),
  roots: Schema.Boolean.pipe(Schema.optional),
  start: Schema.Finite.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
})
type SessionCursor = typeof SessionCursor.Type

const decodeCursor = Schema.decodeUnknownSync(SessionCursor)

const sessionCursor = {
  encode(
    session: SessionV2.Info,
    order: "asc" | "desc",
    direction: "previous" | "next",
    filters: Pick<SessionCursor, "directory" | "path" | "workspaceID" | "roots" | "start" | "search">,
  ) {
    return Buffer.from(
      JSON.stringify({ id: session.id, time: session.time.created, order, direction, ...filters }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle(
        "sessions",
        Effect.fn(function* (ctx) {
          const decoded = yield* Effect.try({
            try: () => (ctx.query.cursor ? sessionCursor.decode(ctx.query.cursor) : undefined),
            catch: () => new HttpApiError.BadRequest({}),
          })
          const order = decoded?.order ?? ctx.query.order ?? "desc"
          const filters = decoded ?? {
            directory: ctx.query.directory,
            path: ctx.query.path,
            workspaceID: ctx.query.workspace ? WorkspaceID.make(ctx.query.workspace) : undefined,
            roots: ctx.query.roots,
            start: ctx.query.start,
            search: ctx.query.search,
          }
          const sessions = yield* session.list({
            limit: ctx.query.limit ?? DefaultSessionsLimit,
            order,
            directory: filters.directory,
            path: filters.path,
            workspaceID: filters.workspaceID,
            roots: filters.roots,
            start: filters.start,
            search: filters.search,
            cursor: decoded ? { id: decoded.id, time: decoded.time, direction: decoded.direction } : undefined,
          })
          const first = sessions[0]
          const last = sessions.at(-1)
          return {
            items: sessions,
            cursor: {
              previous: first ? sessionCursor.encode(first, order, "previous", filters) : undefined,
              next: last ? sessionCursor.encode(last, order, "next", filters) : undefined,
            },
          }
        }),
      )
      .handle(
        "prompt",
        Effect.fn(function* (ctx) {
          return yield* session.prompt({
            sessionID: ctx.params.sessionID,
            prompt: ctx.payload.prompt,
            delivery: ctx.payload.delivery ?? SessionV2.DefaultDelivery,
          })
        }),
      )
      .handle(
        "compact",
        Effect.fn(function* (ctx) {
          yield* session.compact(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "wait",
        Effect.fn(function* (ctx) {
          yield* session.wait(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "context",
        Effect.fn(function* (ctx) {
          return yield* session.context(ctx.params.sessionID)
        }),
      )
  }),
)
