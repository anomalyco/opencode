export * as Location from "./location"

import { Effect, Schema } from "effect"
import { AbsolutePath, optionalOmitUndefined } from "./schema"
import { ProjectID } from "./project-id"
import { WorkspaceID } from "./workspace-id"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  directory: AbsolutePath,
  workspaceID: Schema.optional(WorkspaceID).pipe(
    Schema.withDecodingDefault(Effect.succeed(undefined)),
    Schema.withConstructorDefault(Effect.succeed(undefined)),
  ),
}).annotate({ identifier: "Location.Ref" })

export class Info extends Schema.Class<Info>("Location.Info")({
  directory: AbsolutePath,
  workspaceID: optionalOmitUndefined(WorkspaceID),
  project: Schema.Struct({
    id: ProjectID,
    directory: AbsolutePath,
  }),
}) {}

export function response<S extends Schema.Top>(data: S) {
  return Schema.Struct({ location: Info, data })
}
