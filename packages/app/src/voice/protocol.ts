import { Option, Schema } from "effect"

const Item = Schema.Struct({
  type: Schema.String,
  call_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.String),
})

const Envelope = Schema.Struct({
  type: Schema.String,
  event_id: Schema.optional(Schema.String),
  client_event_id: Schema.optional(Schema.String),
  delta: Schema.optional(Schema.String),
  delegation_id: Schema.optional(Schema.NullOr(Schema.String)),
  delegation: Schema.optional(Schema.Struct({ id: Schema.String, target: Schema.String })),
  event: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      item: Schema.optional(Item),
      response: Schema.optional(Schema.Struct({ id: Schema.String, status: Schema.optional(Schema.String) })),
    }),
  ),
})

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Envelope))

export type VoiceEvent = typeof Envelope.Type

export const decodeEvent = (raw: string) => Option.getOrUndefined(decode(raw))

export const decodeArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      session_id: Schema.optional(Schema.String),
      query: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }))),
      cursor: Schema.optional(Schema.String),
      directory: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
      delivery: Schema.optional(Schema.Literals(["steer", "queue"])),
      model: Schema.optional(Schema.String),
      variant: Schema.optional(Schema.String),
    }),
  ),
)

export type ToolCall = { call_id: string; name: string; arguments: string }
