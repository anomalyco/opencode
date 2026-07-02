export * as PermissionSaved from "./permission-saved.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { ProjectID } from "./project-id.js"
import { statics } from "./schema.js"

export const ID = Schema.String.pipe(
  Schema.brand("PermissionSaved.ID"),
  statics((schema) => ({ create: () => schema.make("psv_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  projectID: ProjectID,
  action: Schema.String,
  resource: Schema.String,
}).annotate({ identifier: "PermissionSaved.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
