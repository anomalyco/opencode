export * as SessionError from "./session-error.js"

import { Schema } from "effect"

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "Session.StructuredError" })
