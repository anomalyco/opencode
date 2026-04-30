import { SessionMessage } from "@/v2/session-message"
import { SessionV2 } from "@/v2/session"
import { Effect, Layer, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const DefaultMessagesLimit = 50

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  time: Schema.Number,
  from: Schema.Union([Schema.Literal("start"), Schema.Literal("end")]),
})

const decodeCursor = Schema.decodeUnknownSync(Cursor)

const cursor = {
  encode(message: SessionMessage.Message, from: "start" | "end") {
    return Buffer.from(
      JSON.stringify({ id: message.id, time: DateTime.toEpochMillis(message.time.created), from }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const v2Handlers = HttpApiBuilder.group(InstanceHttpApi, "v2", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle(
        "messages",
        Effect.fn(function* (ctx) {
          const decoded = yield* Effect.try({
            try: () =>
              ctx.query.cursor && ctx.query.cursor !== "start" && ctx.query.cursor !== "end"
                ? cursor.decode(ctx.query.cursor)
                : undefined,
            catch: () => new HttpApiError.BadRequest({}),
          })
          const messages = yield* session.messages({
            sessionID: ctx.params.sessionID,
            limit: ctx.query.limit ?? DefaultMessagesLimit,
            from: decoded?.from ?? (ctx.query.cursor === "start" ? "start" : "end"),
            cursor: decoded ? { id: decoded.id, time: decoded.time } : undefined,
          })
          const oldest = messages[0]
          const newest = messages.at(-1)
          return {
            items: messages,
            cursor: {
              before: oldest ? cursor.encode(oldest, "end") : undefined,
              after: newest ? cursor.encode(newest, "start") : undefined,
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
  }),
).pipe(Layer.provide(SessionV2.defaultLayer))
