export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@moks/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
