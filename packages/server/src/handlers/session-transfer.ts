import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTransfer } from "@opencode-ai/core/session/transfer"
import { ConflictError, SessionNotFoundError, UnknownError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const SessionTransferHandler = HttpApiBuilder.group(Api, "server.sessionTransfer", (handlers) =>
  Effect.gen(function* () {
    const transfer = yield* SessionTransfer.Service

    return handlers
      .handle(
        "sessionTransfer.import",
        Effect.fn(function* (ctx) {
          return {
            data: yield* transfer
              .import({
                data: { info: ctx.payload.info, messages: ctx.payload.messages },
                location: ctx.payload.location ?? { directory: AbsolutePath.make(process.cwd()) },
              })
              .pipe(
                Effect.catchTag(
                  "SessionTransfer.ImportConflictError",
                  (error) =>
                    new ConflictError({
                      message: `Session already exists: ${error.sessionID}`,
                      resource: error.sessionID,
                    }),
                ),
              ),
          }
        }),
      )
      .handle(
        "sessionTransfer.export",
        Effect.fn(function* (ctx) {
          return {
            data: yield* transfer.export({ sessionID: ctx.params.sessionID, sanitize: ctx.query.sanitize }).pipe(
              Effect.catchTag(
                "Session.NotFoundError",
                (error) =>
                  new SessionNotFoundError({
                    sessionID: error.sessionID,
                    message: `Session not found: ${error.sessionID}`,
                  }),
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
  }),
)
