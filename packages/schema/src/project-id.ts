import { Schema } from "effect"
import { withStatics } from "./schema"

export const ProjectID = Schema.String.pipe(
  Schema.brand("Project.ID"),
  withStatics((schema) => ({ global: schema.make("global") })),
)
export type ProjectID = typeof ProjectID.Type
