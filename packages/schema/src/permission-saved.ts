export * as PermissionSaved from "./permission-saved"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { Project } from "./project"
import { withStatics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("PermissionSaved.ID"),
  withStatics((schema) => ({ create: () => schema.make("psv_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID,
  projectID: Project.ID,
  action: Schema.String,
  resource: Schema.String,
}).annotate({ identifier: "PermissionSaved.Info" })
export type Info = typeof Info.Type
