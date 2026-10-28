export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema.js"

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })).pipe(optional),
  response: Schema.Struct({ body: Schema.String }).pipe(optional),
  /** How long the provider asked to wait before trying again, counted from when the failure was recorded. */
  retryAfterMs: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "Session.StructuredError" })
