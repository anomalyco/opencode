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
  /** Why a `session.closed` closed. */
  reason: Schema.optional(Schema.String),
  error: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.NullOr(Schema.String)),
      code: Schema.optional(Schema.NullOr(Schema.String)),
      message: Schema.optional(Schema.NullOr(Schema.String)),
      client_event_id: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  event: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      item: Schema.optional(Item),
      response: Schema.optional(Schema.Struct({ id: Schema.String, status: Schema.optional(Schema.String) })),
      message: Schema.optional(Schema.NullOr(Schema.String)),
      code: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Envelope))

export type VoiceEvent = typeof Envelope.Type

export const decodeEvent = (raw: string) => Option.getOrUndefined(decode(raw))

/**
 * What a GPT-Live `error` means for the call, as the iOS app's `RealtimeServerError.Disposition`: most are races to
 * shrug off, an expired session reconnects, and only a credential or account problem ends the call.
 */
export function errorDisposition(error: NonNullable<VoiceEvent["error"]>) {
  const text = [error.type, error.code, error.message].flatMap((part) => (part ? [part.toLowerCase()] : [])).join(" ")

  if (error.code === "session_expired" || error.code === "expired" || text.includes("maximum duration"))
    return "expired"

  const fatal = ["authentication", "invalid_api_key", "api key", "permission", "insufficient_quota", "quota", "billing"]

  if ([...fatal, "model_not_found"].some((marker) => text.includes(marker))) return "fatal"

  return "harmless"
}

/** A harmless error that cuts the agent's current speech short, such as moderation, rather than a refused command. */
export function cutsOffSpeech(error: NonNullable<VoiceEvent["error"]>) {
  if (error.client_event_id) return false
  const text = [error.type, error.code, error.message].flatMap((part) => (part ? [part.toLowerCase()] : [])).join(" ")
  const markers = ["moderation", "content_filter", "safety", "output_audio", "interrupted", "cut_off", "truncated"]

  return !error.code || markers.some((marker) => text.includes(marker))
}

export const decodeArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      session_id: Schema.optional(Schema.String),
      query: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }))),
      cursor: Schema.optional(Schema.String),
      message_id: Schema.optional(Schema.String),
      offset: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
      directory: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
      delivery: Schema.optional(Schema.Literals(["steer", "queue"])),
      model: Schema.optional(Schema.String),
      variant: Schema.optional(Schema.String),
      request_id: Schema.optional(Schema.String),
      decision: Schema.optional(Schema.Literals(["once", "always", "reject"])),
      note: Schema.optional(Schema.String),
      form_id: Schema.optional(Schema.String),
      answers: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]),
        ),
      ),
    }),
  ),
)

export type ToolCall = { call_id: string; name: string; arguments: string }
