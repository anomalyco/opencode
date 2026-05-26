import { WorkspaceID } from "@/control-plane/schema"
import { SessionV2 } from "@/v2/session"
import { DateTime, Effect, Option, Schema } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import {
  InvalidCursorError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnknownError,
} from "../../errors"

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

function hasCursorFilter(query: {
  readonly order?: unknown
  readonly path?: unknown
  readonly roots?: unknown
  readonly start?: unknown
  readonly search?: unknown
}) {
  return (
    query.order !== undefined ||
    query.path !== undefined ||
    query.roots !== undefined ||
    query.start !== undefined ||
    query.search !== undefined
  )
}

function hasCursorRoutingMismatch(
  query: { readonly directory?: string; readonly workspace?: string },
  decoded: SessionCursor | undefined,
) {
  if (!decoded) return false
  if (query.directory !== undefined && query.directory !== decoded.directory) return true
  return query.workspace !== undefined && query.workspace !== decoded.workspaceID
}

const sessionCursor = {
  encode(
    session: SessionV2.Info,
    order: "asc" | "desc",
    direction: "previous" | "next",
    filters: Pick<SessionCursor, "directory" | "path" | "workspaceID" | "roots" | "start" | "search">,
  ) {
    return Buffer.from(
      JSON.stringify({
        ...filters,
        id: session.id,
        time: DateTime.toEpochMillis(session.time.updated),
        order,
        direction,
      }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

function decodeWorkspaceID(input: string | undefined) {
  if (input === undefined) return Effect.succeed(undefined)
  const workspaceID = Schema.decodeUnknownOption(WorkspaceID)(input)
  if (Option.isSome(workspaceID)) return Effect.succeed(workspaceID.value)
  return Effect.fail(
    new InvalidRequestError({
      message: "Invalid workspace query parameter",
      kind: "Query",
      field: "workspace",
    }),
  )
}

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle(
        "sessions",
        Effect.fn(function* (ctx) {
          if (ctx.query.cursor && hasCursorFilter(ctx.query))
            return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order or filters" })
          const decoded = yield* Effect.try({
            try: () => (ctx.query.cursor ? sessionCursor.decode(ctx.query.cursor) : undefined),
            catch: () => new InvalidCursorError({ message: "Invalid cursor" }),
          })
          if (hasCursorRoutingMismatch(ctx.query, decoded))
            return yield* new InvalidCursorError({ message: "Cursor does not match requested directory or workspace" })
          const order = decoded?.order ?? ctx.query.order ?? "desc"
          const filters = decoded ?? {
            directory: ctx.query.directory,
            path: ctx.query.path,
            workspaceID: yield* decodeWorkspaceID(ctx.query.workspace),
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
          return yield* session
            .prompt({
              sessionID: ctx.params.sessionID,
              prompt: ctx.payload.prompt,
              delivery: ctx.payload.delivery ?? SessionV2.DefaultDelivery,
            })
            .pipe(
              Effect.catchTag("Session.NotFoundError", (error) =>
                Effect.fail(
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
                ),
              ),
              Effect.catchTag("Session.OperationUnavailableError", (error) =>
                Effect.fail(
                  new ServiceUnavailableError({
                    message: `V2 session ${error.operation} is not available yet`,
                    service: `v2.session.${error.operation}`,
                  }),
                ),
              ),
            )
        }),
      )
      .handle(
        "compact",
        Effect.fn(function* (ctx) {
          yield* session.compact(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `V2 session ${error.operation} is not available yet`,
                  service: `v2.session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "wait",
        Effect.fn(function* (ctx) {
          yield* session.wait(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.OperationUnavailableError", (error) =>
              Effect.fail(
                new ServiceUnavailableError({
                  message: `V2 session ${error.operation} is not available yet`,
                  service: `v2.session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "context",
        Effect.fn(function* (ctx) {
          return yield* session.context(ctx.params.sessionID).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.catchTag("Session.MessageDecodeError", (error) => {
              const ref = `err_${crypto.randomUUID().slice(0, 8)}`
              return Effect.logError("failed to decode v2 session message").pipe(
                Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
                Effect.andThen(
                  Effect.fail(
                    new UnknownError({
                      message: "Unexpected server error. Check server logs for details.",
                      ref,
                    }),
                  ),
                ),
              )
            }),
          )
        }),
      )
  }),
)
