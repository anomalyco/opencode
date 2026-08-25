export * as Project from "./project.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { AbsolutePath, NonNegativeInt, optional } from "./schema.js"
import { ProjectID } from "./project-id.js"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.Literals(["git", "hg"]).annotate({ identifier: "Project.Vcs" })
export const Current = Schema.Struct({
  id: ID,
  directory: AbsolutePath,
  canonical: AbsolutePath,
}).annotate({ identifier: "Project.Current" })
export interface Current extends Schema.Schema.Type<typeof Current> {}
export const Icon = Schema.Struct({
  url: optional(Schema.String),
  override: optional(Schema.String),
  color: optional(Schema.String),
}).annotate({ identifier: "Project.Icon" })
export interface Icon extends Schema.Schema.Type<typeof Icon> {}
export const Commands = Schema.Struct({
  start: optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
}).annotate({ identifier: "Project.Commands" })
export interface Commands extends Schema.Schema.Type<typeof Commands> {}
export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optional(NonNegativeInt),
}).annotate({ identifier: "Project.Time" })
export interface Time extends Schema.Schema.Type<typeof Time> {}

export const Info = Schema.Struct({
  id: ID,
  canonical: AbsolutePath,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const UpdateInput = Schema.Struct({
  projectID: ID,
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
}).annotate({ identifier: "Project.UpdateInput" })
export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}

const Updated = ephemeral({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }
