import { Schema } from "effect"

export const WebSocketEventSchema = Schema.Union([
  Schema.Struct({
    direction: Schema.Literals(["client", "server"]),
    kind: Schema.tag("text"),
    body: Schema.String,
  }),
  Schema.Struct({
    direction: Schema.Literals(["client", "server"]),
    kind: Schema.tag("binary"),
    body: Schema.String,
    bodyEncoding: Schema.Literal("base64"),
  }),
])

export type WebSocketEvent = Schema.Schema.Type<typeof WebSocketEventSchema>

export const WebSocketInteractionSchema = Schema.Struct({
  transport: Schema.tag("websocket"),
  connection: Schema.optional(
    Schema.Struct({
      sequence: Schema.Number,
      url: Schema.String,
      protocols: Schema.Array(Schema.String),
      close: Schema.Struct({
        code: Schema.Number,
        reason: Schema.String,
      }),
    }),
  ),
  events: Schema.Array(WebSocketEventSchema),
})

export interface WebSocketInteraction extends Schema.Schema.Type<typeof WebSocketInteractionSchema> {}
