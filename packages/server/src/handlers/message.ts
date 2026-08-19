import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import {
  InvalidCursorError,
  MessageNotFoundError,
  SessionNotFoundError,
  UnknownError,
} from "@opencode-ai/protocol/errors"

const DefaultMessagesLimit = 50

const LegacyCursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})

const SequenceCursor = Schema.Struct({
  v: Schema.Literal(1),
  sessionID: SessionV2.ID,
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})

const Cursor = Schema.Union([SequenceCursor, LegacyCursor])
const decodeCursor = Schema.decodeUnknownSync(Cursor)

const cursor = {
  encode(sessionID: SessionV2.ID, seq: number, order: "asc" | "desc", direction: "previous" | "next") {
    return Buffer.from(JSON.stringify({ v: 1, sessionID, seq, order, direction })).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers.handle(
      "session.messages",
      Effect.fn(function* (ctx) {
        if (ctx.query.cursor && ctx.query.order !== undefined)
          return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
        const decoded = yield* Effect.try({
          try: () => (ctx.query.cursor ? cursor.decode(ctx.query.cursor) : undefined),
          catch: () => new InvalidCursorError({ message: "Invalid cursor" }),
        })
        if (decoded && "seq" in decoded && decoded.sessionID !== ctx.params.sessionID)
          return yield* new InvalidCursorError({ message: "Cursor belongs to another session" })
        const order = decoded?.order ?? ctx.query.order ?? "desc"
        const page = yield* session
          .messagePage({
            sessionID: ctx.params.sessionID,
            limit: ctx.query.limit ?? DefaultMessagesLimit,
            order,
            cursor: decoded
              ? { ...("seq" in decoded ? { seq: decoded.seq } : { id: decoded.id }), direction: decoded.direction }
              : undefined,
            includeRevert: !decoded,
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
            Effect.catchTag("Session.MessageNotFoundError", (error) =>
              Effect.fail(
                new MessageNotFoundError({
                  sessionID: error.sessionID,
                  messageID: error.messageID,
                  message: `Message not found: ${error.messageID}`,
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
        const revertBoundary = page.revert
          ? [...page.context, ...page.data].find((message) => message.id === page.revert?.messageID)
          : undefined
        const revertSeq = revertBoundary ? page.sequence.get(revertBoundary.id) : undefined
        if (revertBoundary && revertSeq === undefined) {
          const ref = `err_${crypto.randomUUID().slice(0, 8)}`
          yield* Effect.logError("missing session message sequence for pagination cursor").pipe(
            Effect.annotateLogs({ ref, sessionID: ctx.params.sessionID }),
          )
          return yield* new UnknownError({ message: "Unexpected server error. Check server logs for details.", ref })
        }
        return {
          data: page.data,
          context: page.context,
          contextCursor:
            order === "desc" && revertSeq !== undefined
              ? cursor.encode(ctx.params.sessionID, revertSeq, order, "next")
              : undefined,
          revert: page.revert,
          cursor: {
            previous:
              page.cursor.previous === undefined
                ? undefined
                : cursor.encode(ctx.params.sessionID, page.cursor.previous, order, "previous"),
            next:
              page.cursor.next === undefined
                ? undefined
                : cursor.encode(ctx.params.sessionID, page.cursor.next, order, "next"),
          },
        }
      }),
    )
  }),
)
