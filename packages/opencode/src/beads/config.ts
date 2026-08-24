export * as ConfigBeads from "./config"

import { Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable beads sync (default: true)",
  }),
  dir: Schema.optional(Schema.String).annotate({
    description: "Path to .beads directory (default: .beads)",
  }),
}).annotate({ identifier: "BeadsConfig" })
export type Info = Schema.Schema.Type<typeof Info>
