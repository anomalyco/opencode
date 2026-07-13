export * as ConfigContextV1 from "./context"

import { Schema } from "effect"
import { NonNegativeInt, type DeepMutable } from "../../schema"

export const Info = Schema.Struct({
  autoAdd: Schema.optional(Schema.Boolean).annotate({
    description: "Automatically add relevant files to the session context based on the user's query (default: false)",
  }),
  maxFiles: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum number of files to automatically add to context (default: 10)",
  }),
  includeTests: Schema.optional(Schema.Boolean).annotate({
    description: "Include test files matching the current module in auto-added context (default: true)",
  }),
}).annotate({ identifier: "ContextConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
