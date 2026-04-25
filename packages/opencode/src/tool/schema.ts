import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const toolIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("tool") }).pipe(Schema.brand("ToolID"))

export type ToolID = typeof toolIdSchema.Type

export const ToolID = toolIdSchema.pipe(
  withStatics((schema: typeof toolIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("tool", id)),
    zod: zod(schema),
  })),
)
