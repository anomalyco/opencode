import { Session } from "@opencode-ai/core/session"
import { SessionMessagesCursor } from "@opencode-ai/schema/session-messages-cursor"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidCursorError, SessionNotFoundError, UnknownError } from "@opencode-ai/protocol/errors"

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle(
      "session.messages",
      Effect.fn(function* (ctx) {
        if (ctx.query.cursor && ctx.query.order !== undefined)
          return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
        const decoded = ctx.query.cursor
          ? yield* SessionMessagesCursor.parse(ctx.query.cursor).pipe(
              Effect.mapError(() => new InvalidCursorError({ message: "Invalid cursor" })),
            )
          : undefined
        const order = decoded?.order ?? ctx.query.order ?? "desc"
        const messages = yield* session
          .messages({
            sessionID: ctx.params.sessionID,
            limit: ctx.query.limit ?? SessionMessagesCursor.DefaultLimit,
            order,
            cursor: decoded ? { id: decoded.id, direction: decoded.direction } : undefined,
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
          )
        return {
          data: messages,
          cursor: SessionMessagesCursor.page(messages, order),
        }
      }),
    )
  }),
)
