export * as Location from "./location"

import { Effect, Schema } from "effect"
import { AbsolutePath } from "./schema"
import { WorkspaceID } from "./workspace-id"

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  directory: AbsolutePath,
  workspaceID: Schema.optional(WorkspaceID).pipe(
    Schema.withDecodingDefault(Effect.succeed(undefined)),
    Schema.withConstructorDefault(Effect.succeed(undefined)),
  ),
}).annotate({ identifier: "Location.Ref" })
