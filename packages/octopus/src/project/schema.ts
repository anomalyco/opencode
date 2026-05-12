import { Schema } from "effect"

import { zod } from "@octopus-ai/core/effect-zod"
import { withStatics } from "@octopus-ai/core/schema"

const projectIdSchema = Schema.String.pipe(Schema.brand("ProjectID"))

export type ProjectID = typeof projectIdSchema.Type

export const ProjectID = projectIdSchema.pipe(
  withStatics((schema: typeof projectIdSchema) => ({
    global: schema.make("global"),
    zod: zod(schema),
  })),
)
