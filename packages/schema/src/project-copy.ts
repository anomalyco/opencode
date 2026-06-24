export * as ProjectCopy from "./project-copy"

import { Schema } from "effect"
import { Project } from "./project"
import { AbsolutePath } from "./schema"

export const StrategyID = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("ProjectCopy.StrategyID"))
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Schema.Struct({
  projectID: Project.ID,
  strategy: StrategyID,
  sourceDirectory: AbsolutePath,
  directory: AbsolutePath,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "ProjectCopy.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const RemoveInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  force: Schema.Boolean,
}).annotate({ identifier: "ProjectCopy.RemoveInput" })
export type RemoveInput = typeof RemoveInput.Type

export const Copy = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectCopy.Copy" })
export type Copy = typeof Copy.Type
