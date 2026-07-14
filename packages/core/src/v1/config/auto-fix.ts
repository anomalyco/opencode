export * as ConfigAutoFixV1 from "./auto-fix"

import { Schema } from "effect"
import { NonNegativeInt, type DeepMutable } from "../../schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Automatically fix lint and compilation errors after each turn (default: false)",
  }),
  maxIterations: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum number of fix iterations when sending errors back to the LLM (default: 3)",
  }),
  tools: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Linter/compiler tools to use: biome, eslint, oxlint, tsc (default: all available)",
  }),
}).annotate({ identifier: "AutoFixConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
