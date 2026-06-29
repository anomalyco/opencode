export * as Project from "./project"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { AbsolutePath, NonNegativeInt, optional } from "./schema"
import { ProjectID } from "./project-id"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.Literal("git").annotate({ identifier: "Project.Vcs" })
export const Current = Schema.Struct({
  id: ID,
  directory: AbsolutePath,
}).annotate({ identifier: "Project.Current" })
export interface Current extends Schema.Schema.Type<typeof Current> {}
export const Directory = Schema.Struct({
  directory: AbsolutePath,
  strategy: optional(Schema.String),
}).annotate({ identifier: "Project.Directory" })
export interface Directory extends Schema.Schema.Type<typeof Directory> {}
export const DirectoriesInput = Schema.Struct({
  projectID: ID,
}).annotate({ identifier: "Project.DirectoriesInput" })
export interface DirectoriesInput extends Schema.Schema.Type<typeof DirectoriesInput> {}
export const Directories = Schema.Array(Directory).annotate({ identifier: "Project.Directories" })
export type Directories = typeof Directories.Type
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
  worktree: Schema.String,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }
