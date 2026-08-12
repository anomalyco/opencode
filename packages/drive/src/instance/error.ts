import * as Schema from "effect/Schema"

export class OpenCodeInstanceError extends Schema.TaggedErrorClass<OpenCodeInstanceError>()(
  "OpenCodeInstanceError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

/** Coerces any cause into an `OpenCodeInstanceError`, preserving existing ones. */
export function instanceError(operation: string, cause: unknown) {
  if (cause instanceof OpenCodeInstanceError) return cause
  return new OpenCodeInstanceError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  })
}
