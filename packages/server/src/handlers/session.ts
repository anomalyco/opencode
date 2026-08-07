import { SessionV2 } from "@opencode-ai/core/session"
import { UserContext } from "@opencode-ai/schema/user-context"
import type { Session } from "@opencode-ai/schema/session"
import { DateTime, Effect, Option, Stream } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { SessionsCursor } from "@opencode-ai/protocol/groups/session"
import {
  ConflictError,
  ForbiddenError,
  InvalidCursorError,
  MessageNotFoundError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnknownError,
} from "@opencode-ai/protocol/errors"
import { AbsolutePath } from "@opencode-ai/core/schema"

const DefaultSessionsLimit = 50
const DefaultSessionHistoryLimit = 50

// ─── Ownership helpers ────────────────────────────────────────────

function canAccess(
  userContext: UserContext.Info | undefined,
  session: Session.Info,
  options?: { hideExistence?: boolean },
): boolean {
  if (!userContext) return true // No JWT configured, allow all
  switch (userContext.role) {
    case "global_admin":
      return true
    case "dept_admin":
      // dept_admin can see own sessions + sessions in their department
      if (session.userID === userContext.userID) return true
      if (!session.userDepartmentCode) return false // null dept sessions not exposed to dept_admin
      return session.userDepartmentCode === userContext.departmentCode
    case "user":
    default:
      return session.userID === userContext.userID
  }
}

function assertSessionAccess(
  userContext: UserContext.Info | undefined,
  session: Session.Info,
  options?: { hideExistence?: boolean },
): Effect.Effect<void, SessionNotFoundError | ForbiddenError> {
  if (canAccess(userContext, session)) return Effect.void
  if (options?.hideExistence) {
    // Return 404 to prevent session ID enumeration (used for prompt)
    return Effect.fail(new SessionNotFoundError({ sessionID: session.id, message: "Session not found" }))
  }
  return Effect.fail(new ForbiddenError({ message: "You do not have access to this session" }))
}

function withSessionAccess(
  sessionID: string,
  sessionService: SessionV2.Interface,
  userContext: Option.Option<UserContext.Info>,
  options?: { hideExistence?: boolean },
): Effect.Effect<Session.Info, SessionNotFoundError | ForbiddenError> {
  const optionUser = Option.getOrUndefined(userContext)
  return sessionService.get(sessionID as any).pipe(
    Effect.catchTag("Session.NotFoundError", (error) =>
      Effect.fail(new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` })),
    ),
    Effect.flatMap((s) => assertSessionAccess(optionUser, s, options).pipe(Effect.as(s))),
  )
}

// ─── Handler ──────────────────────────────────────────────────────

export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle(
        "session.list",
        Effect.fn(function* (ctx) {
          const userContext = Option.getOrUndefined(yield* UserContext.Service.pipe(Effect.option))
          const query =
            ctx.query.cursor !== undefined
              ? yield* SessionsCursor.parse(ctx.query.cursor).pipe(
                  Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
                )
              : ctx.query
          const sessions = yield* session.list({
            ...query,
            workspaceID: query.workspace,
            limit: ctx.query.limit ?? DefaultSessionsLimit,
          })

          // Filter sessions by access
          const filtered = userContext
            ? sessions.filter((s) => canAccess(userContext, s))
            : sessions

          const first = filtered[0]
          const last = filtered.at(-1)
          return {
            data: filtered,
            cursor: {
              previous: first
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: first.id,
                      time: DateTime.toEpochMillis(first.time.created),
                      direction: "previous",
                    },
                  })
                : undefined,
              next: last
                ? SessionsCursor.make({
                    ...query,
                    anchor: {
                      id: last.id,
                      time: DateTime.toEpochMillis(last.time.created),
                      direction: "next",
                    },
                  })
                : undefined,
            },
          }
        }),
      )
      .handle(
        "session.create",
        Effect.fn(function* (ctx) {
          const userContext = Option.getOrUndefined(yield* UserContext.Service.pipe(Effect.option))
          const result = yield* session.create({
            id: ctx.payload.id,
            agent: ctx.payload.agent,
            model: ctx.payload.model,
            location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) },
            userID: userContext?.userID,
            userDepartmentCode: userContext?.departmentCode,
          })
          return { data: result }
        }),
      )
      .handle(
        "session.active",
        Effect.fn(function* () {
          return {
            data: Object.fromEntries(
              Array.from(yield* session.active, (sessionID) => [sessionID, { type: "running" as const }]),
            ),
          }
        }),
      )
      .handle(
        "session.get",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          const result = yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          return { data: result }
        }),
      )
      .handle(
        "session.switchAgent",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          yield* session.switchAgent({ sessionID: ctx.params.sessionID, agent: ctx.payload.agent }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.switchModel",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          yield* session.switchModel({ sessionID: ctx.params.sessionID, model: ctx.payload.model }).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.prompt",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext, { hideExistence: true })
          return {
            data: yield* session
              .prompt({
                sessionID: ctx.params.sessionID,
                id: ctx.payload.id,
                prompt: ctx.payload.prompt,
                delivery: ctx.payload.delivery,
                resume: ctx.payload.resume,
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
                Effect.catchTag("Session.PromptConflictError", (error) =>
                  Effect.fail(
                    new ConflictError({
                      message: `Prompt message ID conflicts with an existing durable record: ${error.messageID}`,
                      resource: error.messageID,
                    }),
                  ),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.compact",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          yield* session.compact({ sessionID: ctx.params.sessionID }).pipe(
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
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.wait",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
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
                  message: `Session ${error.operation} is not available yet`,
                  service: `session.${error.operation}`,
                }),
              ),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.revert.stage",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          return {
            data: yield* session.revert.stage({ ...ctx.params, ...ctx.payload }).pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
              Effect.catchTag(
                "Session.MessageNotFoundError",
                (error) =>
                  new MessageNotFoundError({
                    sessionID: error.sessionID,
                    messageID: error.messageID,
                    message: `Message not found: ${error.messageID}`,
                  }),
              ),
              Effect.catchTag("Snapshot.Error", (error) => {
                const ref = `err_${crypto.randomUUID().slice(0, 8)}`
                return Effect.logError("failed to stage session revert", { cause: error }).pipe(
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
            ),
          }
        }),
      )
      .handle(
        "session.revert.clear",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          yield* session.revert.clear(ctx.params.sessionID).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
            Effect.catchTag("Snapshot.Error", (error) => {
              const ref = `err_${crypto.randomUUID().slice(0, 8)}`
              return Effect.logError("failed to clear session revert", { cause: error }).pipe(
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
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.revert.commit",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          yield* session.revert.commit(ctx.params.sessionID).pipe(
            Effect.catchTag(
              "Session.NotFoundError",
              (error) =>
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.context",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          return {
            data: yield* session.context(ctx.params.sessionID).pipe(
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
                return Effect.logError("failed to decode session message").pipe(
                  Effect.annotateLogs({ ref, sessionID: error.sessionID, messageID: error.messageID }),
                  Effect.andThen(
                    Effect.fail(
                      new UnknownError({ message: "Unexpected server error. Check server logs for details.", ref }),
                    ),
                  ),
                )
              }),
            ),
          }
        }),
      )
      .handle(
        "session.history",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          return yield* session
            .history({
              sessionID: ctx.params.sessionID,
              after: ctx.query.after,
              limit: ctx.query.limit ?? DefaultSessionHistoryLimit,
            })
            .pipe(
              Effect.map((page) => ({
                data: page.events,
                hasMore: page.hasMore,
              })),
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
              ),
            )
        }),
      )
      .handle(
        "session.events",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          return Effect.succeed(
            session.events({ sessionID: ctx.params.sessionID, after: ctx.query.after }).pipe(Stream.orDie),
          )
        }),
      )
      .handle(
        "session.interrupt",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          yield* session.interrupt(ctx.params.sessionID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.message",
        Effect.fn(function* (ctx) {
          const userContext = yield* UserContext.Service.pipe(Effect.option)
          yield* withSessionAccess(ctx.params.sessionID, session, userContext)
          const message = yield* session.message(ctx.params)
          if (message) return { data: message }
          return yield* new MessageNotFoundError({
            sessionID: ctx.params.sessionID,
            messageID: ctx.params.messageID,
            message: `Message not found: ${ctx.params.messageID}`,
          })
        }),
      )
  }),
)
