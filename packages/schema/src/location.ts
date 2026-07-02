export * as Location from "./location.js"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema.js"
import { ProjectID } from "./project-id.js"
import { WorkspaceID } from "./workspace-id.js"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  directory: AbsolutePath,
  workspaceID: optional(WorkspaceID),
}).annotate({ identifier: "Location.Ref" })

export class Info extends Schema.Class<Info>("Location.Info")({
  directory: AbsolutePath,
  workspaceID: optional(WorkspaceID),
  project: Schema.Struct({
    id: ProjectID,
    directory: AbsolutePath,
  }),
}) {}

export function response<S extends Schema.Top>(data: S) {
  return Schema.Struct({ location: Info, data })
}
