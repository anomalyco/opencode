export * as Formatter from "./formatter.js"

import { Schema } from "effect"

export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  name: Schema.String,
  extensions: Schema.Array(Schema.String),
  enabled: Schema.Boolean.annotate({
    description: "Whether the formatter resolved a runnable command for the current location.",
  }),
}).annotate({ identifier: "Formatter.Status" })
