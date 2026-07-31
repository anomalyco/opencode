export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.Number.pipe(optional),
}).annotate({ identifier: "Session.StructuredError" })
