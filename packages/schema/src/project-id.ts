import { brand } from "./brand.js"
import { Schema } from "effect"
import { statics } from "./schema.js"

export const ProjectID = Schema.String.pipe(
  brand("Project.ID"),
  statics((schema) => ({ global: schema.make("global") })),
)
export type ProjectID = typeof ProjectID.Type
