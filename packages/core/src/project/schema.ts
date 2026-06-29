export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Current = Project.Current
export type Current = typeof Current.Type

export const Directory = Project.Directory
export type Directory = typeof Directory.Type

export const DirectoriesInput = Project.DirectoriesInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = Project.Directories
export type Directories = typeof Directories.Type

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
