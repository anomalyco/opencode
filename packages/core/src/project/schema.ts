export * as ProjectSchema from "./schema.js"

import { Schema } from "effect"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "../schema.js"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Current = Project.Current
export type Current = typeof Current.Type

export const Info = Project.Info
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const UpdateInput = Project.UpdateInput
export type UpdateInput = typeof UpdateInput.Type

export const Event = Project.Event

export const Vcs = Schema.Struct({
  type: Project.Vcs,
  store: AbsolutePath,
})
export type Vcs = typeof Vcs.Type
