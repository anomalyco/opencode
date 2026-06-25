export * as Project from "./project"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { NonNegativeInt, optional } from "./schema"
import { ProjectID } from "./project-id"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.Literal("git")
export const Icon = Schema.Struct({
  url: optional(Schema.String),
  override: optional(Schema.String),
  color: optional(Schema.String),
})
export const Commands = Schema.Struct({
  start: optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})
export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optional(NonNegativeInt),
})

export const Info = Schema.Struct({
  id: ID,
  worktree: Schema.String,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export type Info = typeof Info.Type

const Updated = define({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }
