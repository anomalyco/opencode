import type { SessionMessageAssistant } from "@opencode/client/promise"
import { Effect, Option, Schema } from "effect"
import type { TurnErrorInfo } from "../timeline/turn-phase-machine"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const decodeString = Schema.decodeUnknownOption(Schema.String)

// A field of the wrong type decodes as absent, so one bad field does not discard its neighbours.
function lenient<S extends Schema.Top>(schema: S) {
  return Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)))
}

const decodeErrorEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.optionalKey(Schema.Unknown), message: lenient(Schema.String) }),
)

const decodeErrorDetails = Schema.decodeUnknownOption(
  Schema.Struct({ type: lenient(Schema.String), message: lenient(Schema.String), code: lenient(Schema.String) }),
)

/** What a failed step or turn shows: its message, and when a usage limit or budget comes back. */
export function errorInfo(message: Parameters<typeof usageLimit>[0]): TurnErrorInfo {
  return {
    text: unwrapErrorMessage(message.error?.message ?? ""),
    ...usageLimit(message),
    ...budgetLimit(message),
  }
}

const MAX_RETRY_AFTER_MS = 45 * 86_400_000

function usageLimit(
  message: Pick<SessionMessageAssistant, "error"> & { time: { created: number; completed?: number } },
) {
  const type = message.error?.type

  if (type !== "provider.free-limit" && type !== "provider.go-limit") return {}

  const kind = type === "provider.go-limit" ? ("go-limit" as const) : ("free-limit" as const)
  const delay = message.error?.retryAfterMs
  const base = message.time.completed ?? message.time.created

  if (
    delay === undefined ||
    !Number.isFinite(delay) ||
    delay < 0 ||
    delay > MAX_RETRY_AFTER_MS ||
    !Number.isFinite(base) ||
    Number.isNaN(new Date(base + delay).getTime())
  )
    return { kind }

  return { kind, resetAt: base + delay }
}

// OpenCode Console says when the budget resets in its refusal's metadata, which every protocol's envelope names `resetsAt`.
function budgetLimit(message: Pick<SessionMessageAssistant, "error">) {
  const type = message.error?.type

  if (type !== "provider.budget-limit" && type !== "provider.model-budget-limit") return {}
  const kind = type === "provider.budget-limit" ? ("budget-limit" as const) : ("model-budget-limit" as const)
  const at = Date.parse(/"resetsAt"\s*:\s*"([^"]+)"/.exec(message.error?.response?.body ?? "")?.[1] ?? "")

  if (Number.isNaN(at)) return { kind }

  return { kind, resetAt: at }
}

export function unwrapErrorMessage(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()
  const parse = (value: string) => Option.getOrUndefined(decodeJson(value))

  // A JSON string that itself holds JSON is unwrapped once.
  const read = (value: string) => {
    const first = parse(value)

    return Option.match(decodeString(first), { onNone: () => first, onSome: (inner) => parse(inner.trim()) })
  }

  const whole = read(text)
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  const json = whole === undefined && start !== -1 && end > start ? read(text.slice(start, end + 1)) : whole
  const envelope = Option.getOrUndefined(decodeErrorEnvelope(json))

  if (!envelope) return message
  const error = Option.getOrUndefined(decodeErrorDetails(envelope.error))

  if (error?.type && error.message) return `${error.type}: ${error.message}`

  if (error?.message) return error.message

  if (error?.type) return error.type

  if (error?.code) return error.code

  if (envelope.message) return envelope.message

  return Option.getOrUndefined(decodeString(envelope.error)) || message
}
