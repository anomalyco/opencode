import { SessionMessage } from "@opencode/core/session/message"
import { Session } from "@opencode/core/session"
import { Effect, Option, Schema } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { wantsMediaRefs } from "../media-uri"
import { InvalidCursorError } from "@opencode/protocol/errors"
import { SessionMediaMessagesResponse } from "@opencode/protocol/groups/message"
import { failedMessageDecode, missingSession } from "./session-error"

const DefaultMessagesLimit = 50

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})

const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(Cursor))

const cursor = {
  encode(message: { readonly id: SessionMessage.ID }, order: "asc" | "desc", direction: "previous" | "next") {
    return Buffer.from(JSON.stringify({ id: message.id, order, direction })).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(Buffer.from(input, "base64url").toString("utf8"))
  },
}

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle(
      "session.messages",
      Effect.fn(function* (ctx) {
        if (ctx.query.cursor && ctx.query.order !== undefined)
          return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
        const decoded = ctx.query.cursor
          ? (Option.getOrUndefined(cursor.decode(ctx.query.cursor)) ??
            (yield* new InvalidCursorError({ message: "Invalid cursor" })))
          : undefined
        const order = decoded?.order ?? ctx.query.order ?? "desc"
        const input = {
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit ?? DefaultMessagesLimit,
          order,
          type: ctx.query.type,
          cursor: decoded ? { id: decoded.id, direction: decoded.direction } : undefined,
        }
        const page = <Message extends { readonly id: SessionMessage.ID }>(messages: ReadonlyArray<Message>) => {
          const first = messages[0]
          const last = messages.at(-1)
          return {
            data: messages,
            cursor: {
              previous: first ? cursor.encode(first, order, "previous") : undefined,
              next: last ? cursor.encode(last, order, "next") : undefined,
            },
          }
        }
        if (wantsMediaRefs(ctx.request)) {
          const messages = yield* session
            .messagesWithRefs(input)
            .pipe(
              Effect.catchTag("Session.NotFoundError", missingSession),
              Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
            )
          return yield* HttpServerResponse.schemaJson(SessionMediaMessagesResponse)(page(messages)).pipe(Effect.orDie)
        }
        const messages = yield* session
          .messages(input)
          .pipe(
            Effect.catchTag("Session.NotFoundError", missingSession),
            Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
          )
        return page(messages)
      }),
    )
  }),
)
