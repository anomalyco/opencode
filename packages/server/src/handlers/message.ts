import { SessionMessage } from "@opencode/core/session/message"
import { Session } from "@opencode/core/session"
import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { InvalidCursorError } from "@opencode/protocol/errors"
import { SessionMessagesQuery } from "@opencode/protocol/groups/message"
import { failedMessageDecode, missingSession } from "./session-error"

const DefaultMessagesLimit = 50

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})

const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(Cursor))

const cursor = {
  encode(message: SessionMessage.Info, order: "asc" | "desc", direction: "previous" | "next") {
    return Buffer.from(JSON.stringify({ id: message.id, order, direction })).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(Buffer.from(input, "base64url").toString("utf8"))
  },
}

/** Shared by the stable message list and the experimental timeline, which differ only in attachment mode. */
export const MessageList = Effect.gen(function* () {
  const session = yield* Session.Service

  return Effect.fn(function* (
    sessionID: Session.ID,
    query: typeof SessionMessagesQuery.Type,
    attachments: "inline" | "reference",
  ) {
    if (query.cursor && query.order !== undefined)
      return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
    const decoded = query.cursor
      ? (Option.getOrUndefined(cursor.decode(query.cursor)) ??
        (yield* new InvalidCursorError({ message: "Invalid cursor" })))
      : undefined
    const order = decoded?.order ?? query.order ?? "desc"
    const messages = yield* session
      .messages({
        sessionID,
        limit: query.limit ?? DefaultMessagesLimit,
        order,
        type: query.type,
        attachments,
        cursor: decoded ? { id: decoded.id, direction: decoded.direction } : undefined,
      })
      .pipe(
        Effect.catchTag("Session.NotFoundError", missingSession),
        Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
      )
    const first = messages[0]
    const last = messages.at(-1)
    return {
      data: messages,
      cursor: {
        previous: first ? cursor.encode(first, order, "previous") : undefined,
        next: last ? cursor.encode(last, order, "next") : undefined,
      },
    }
  })
})

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const list = yield* MessageList

    return handlers.handle("session.messages", (ctx) => list(ctx.params.sessionID, ctx.query, "inline"))
  }),
)
