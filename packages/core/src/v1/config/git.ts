export * as ConfigGitV1 from "./git"

import { Schema } from "effect"
import type { DeepMutable } from "../../schema"

export const Info = Schema.Struct({
  autoStage: Schema.optional(Schema.Boolean).annotate({
    description: "Auto-stage all changes when no files are staged for commit (default: false)",
  }),
  conventional: Schema.optional(Schema.Boolean).annotate({
    description: "Enforce Conventional Commits format for generated messages (default: true)",
  }),
}).annotate({ identifier: "GitConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
