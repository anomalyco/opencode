import { Schema } from "effect"

import { withStatics } from "@simpliciocode/core/schema"

const projectIdSchema = Schema.String.pipe(Schema.brand("ProjectID"))

export type ProjectID = typeof projectIdSchema.Type

export const ProjectID = projectIdSchema.pipe(
  withStatics((schema: typeof projectIdSchema) => ({
    global: schema.make("global"),
  })),
)
