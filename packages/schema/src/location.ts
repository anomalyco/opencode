export * as Location from "./location.js"

import { Schema, Struct } from "effect"
import { AbsolutePath, optional } from "./schema.js"
import { ProjectID } from "./project-id.js"
import { WorkspaceID } from "./workspace-id.js"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  directory: AbsolutePath,
  workspaceID: optional(WorkspaceID),
}).annotate({ identifier: "Location.Ref" })

export const PublicRef = Schema.Struct(Struct.omit(Ref.fields, ["workspaceID"])).annotate({
  identifier: "Location.PublicRef",
})
export interface PublicRef extends Schema.Schema.Type<typeof PublicRef> {}

export class Info extends Schema.Class<Info>("Location.Info")({
  directory: AbsolutePath,
  workspaceID: optional(WorkspaceID),
  project: Schema.Struct({
    id: ProjectID,
    directory: AbsolutePath,
    canonical: AbsolutePath,
  }),
}) {}

export class PublicInfo extends Schema.Class<PublicInfo>("Location.PublicInfo")({
  ...Struct.omit(Info.fields, ["workspaceID"]),
  experimental: Schema.optionalKey(Schema.Struct({ tips_queue: Schema.Boolean })),
}) {}

export function response<S extends Schema.Top>(data: S) {
  return Schema.Struct({ location: PublicRef, data })
}
