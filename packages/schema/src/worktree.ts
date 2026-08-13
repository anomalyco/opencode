export * as Worktree from "./worktree.js"

import { Schema } from "effect"
import { durable, ephemeral, inventory } from "./event.js"
import { ProjectID } from "./project-id.js"
import { AbsolutePath, optional } from "./schema.js"
import { Project } from "./project.js"

export const StrategyID = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("Worktree.StrategyID"))
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Schema.Struct({
  projectID: ProjectID,
  strategy: StrategyID,
  from: optional(AbsolutePath),
  directory: AbsolutePath,
  name: optional(Schema.String),
}).annotate({ identifier: "Worktree.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const RemoveInput = Schema.Struct({
  projectID: ProjectID,
  directory: AbsolutePath,
  force: Schema.Boolean,
}).annotate({ identifier: "Worktree.RemoveInput" })
export interface RemoveInput extends Schema.Schema.Type<typeof RemoveInput> {}

export const Info = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "Worktree.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Directory = Schema.Struct({
  directory: AbsolutePath,
  strategy: optional(Schema.String),
}).annotate({ identifier: "Worktree.Directory" })
export interface Directory extends Schema.Schema.Type<typeof Directory> {}

export const ListInput = Schema.Struct({
  projectID: ProjectID,
}).annotate({ identifier: "Worktree.ListInput" })
export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}

export const List = Schema.Array(Directory).annotate({ identifier: "Worktree.List" })
export type List = typeof List.Type

const Updated = ephemeral({
  type: "worktree.updated",
  schema: { projectID: Project.ID },
})

const Resolved = durable({
  type: "worktree.resolved",
  durable: { aggregate: "projectID", version: 1 },
  schema: {
    projectID: Project.ID,
    directory: AbsolutePath,
    previous: Project.ID,
  },
})

export const Event = { Updated, Resolved, Definitions: inventory(Updated, Resolved) }

export function adopt(
  session: { readonly projectID: string; readonly directory: string },
  event: { readonly projectID: string; readonly directory: string; readonly previous: string },
) {
  if (session.projectID !== event.previous && session.projectID !== Project.ID.global) return
  if (session.projectID === event.projectID) return
  const inside =
    session.directory === event.directory ||
    session.directory.startsWith(event.directory + "/") ||
    session.directory.startsWith(event.directory + "\\")
  if (!inside) return
  return {
    projectID: event.projectID,
    subpath:
      session.directory === event.directory
        ? undefined
        : session.directory.slice(event.directory.length + 1).replaceAll("\\", "/"),
  }
}
