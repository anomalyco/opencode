import * as Schema from "effect/Schema"

export class OpenCodeDriverError extends Schema.TaggedErrorClass<OpenCodeDriverError>()(
  "OpenCodeDriverError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export const error = (operation: string, cause: unknown) =>
  cause instanceof OpenCodeDriverError
    ? cause
    : new OpenCodeDriverError({
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
      })
