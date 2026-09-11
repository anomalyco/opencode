export * as ErrorSummary from "./error-summary.js"

import { Option, Schema } from "effect"

const decode = Schema.decodeUnknownOption(
  Schema.Struct({
    name: Schema.optional(Schema.String),
    _tag: Schema.optional(Schema.String),
    code: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    errno: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  }),
)

/** Error messages, stacks and SQL parameters may contain credentials. Retain only diagnostic classifications. */
export function from(error: unknown) {
  const errors: { type: string; code?: string | number; errno?: number }[] = []
  const seen = new Set<unknown>()
  while (error && !seen.has(error) && errors.length < 8) {
    seen.add(error)
    const result = decode(error)
    if (Option.isNone(result)) break
    errors.push({
      type: result.value._tag ?? (error instanceof Error ? error.name : result.value.name) ?? "unknown",
      code: result.value.code,
      errno: result.value.errno,
    })
    error = error instanceof Error ? error.cause : result.value.cause
  }
  return errors
}
