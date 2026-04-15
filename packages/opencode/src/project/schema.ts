import { Schema } from "effect"
import z from "zod"

import { withStatics } from "@/util/schema"

const projectIdSchema = Schema.String.pipe(Schema.brand("ProjectID"))

export type ProjectID = typeof projectIdSchema.Type

export const ProjectID = projectIdSchema.pipe(
  withStatics((schema: typeof projectIdSchema) => ({
    global: schema.make("global"),
    zod: z.string().pipe(z.custom<ProjectID>()),
  })),
)
