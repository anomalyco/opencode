export * as ConfigReference from "./reference"

import { Schema } from "effect"

const Git = Schema.Struct({
  repository: Schema.String.annotate({
    description: "Git repository URL, host/path reference, or GitHub owner/repo shorthand",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "Branch or ref Scout should clone and inspect",
  }),
})

const Local = Schema.Struct({
  path: Schema.String.annotate({
    description: "Absolute path, ~/ path, or workspace-relative path to a local reference directory",
  }),
})

export const Entry = Schema.Union([Schema.String, Git, Local]).annotate({ identifier: "ReferenceConfigEntry" })

export const Info = Schema.Record(Schema.String, Entry).annotate({ identifier: "ReferenceConfig" })
export type Info = Schema.Schema.Type<typeof Info>
