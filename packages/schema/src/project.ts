export * as Project from "./project"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt, optionalOmitUndefined, withStatics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Project.ID"),
  withStatics((schema) => ({ global: schema.make("global") })),
)
export type ID = typeof ID.Type

export const Vcs = Schema.Literal("git")
export const Icon = Schema.Struct({
  url: optionalOmitUndefined(Schema.String),
  override: optionalOmitUndefined(Schema.String),
  color: optionalOmitUndefined(Schema.String),
})
export const Commands = Schema.Struct({
  start: optionalOmitUndefined(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})
export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optionalOmitUndefined(NonNegativeInt),
})

export const Info = Schema.Struct({
  id: ID,
  worktree: Schema.String,
  vcs: optionalOmitUndefined(Vcs),
  name: optionalOmitUndefined(Schema.String),
  icon: optionalOmitUndefined(Icon),
  commands: optionalOmitUndefined(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export type Info = typeof Info.Type

const Updated = define({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }
