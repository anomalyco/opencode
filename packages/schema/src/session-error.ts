export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })).pipe(optional),
}).annotate({ identifier: "Session.StructuredError" })
