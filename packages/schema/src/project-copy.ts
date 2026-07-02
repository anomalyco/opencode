export * as ProjectCopy from "./project-copy.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ProjectID } from "./project-id.js"
import { AbsolutePath } from "./schema.js"

export const StrategyID = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("ProjectCopy.StrategyID"))
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Schema.Struct({
  projectID: ProjectID,
  strategy: StrategyID,
  sourceDirectory: AbsolutePath,
  directory: AbsolutePath,
  name: optional(Schema.String),
}).annotate({ identifier: "ProjectCopy.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const RemoveInput = Schema.Struct({
  projectID: ProjectID,
  directory: AbsolutePath,
  force: Schema.Boolean,
}).annotate({ identifier: "ProjectCopy.RemoveInput" })
export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}

export const Copy = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectCopy.Copy" })
export interface Copy extends Schema.Schema.Type<typeof Copy> {}
