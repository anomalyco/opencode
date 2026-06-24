export * as Project from "./project"

import { Schema } from "effect"
import { withStatics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("Project.ID"),
  withStatics((schema) => ({ global: schema.make("global") })),
)
export type ID = typeof ID.Type
