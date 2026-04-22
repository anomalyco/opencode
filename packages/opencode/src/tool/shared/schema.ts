import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { zod as effectZod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const toolIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("tool") }).pipe(Schema.brand("ToolID"))

export type ToolID = typeof toolIdSchema.Type

export const ToolID = toolIdSchema.pipe(
  withStatics((schema: typeof toolIdSchema) => ({
    make: (id: string) => schema.make(id),
    ascending: (id?: string) => schema.make(Identifier.ascending("tool", id)),
    zod: effectZod(schema).pipe(z.custom<ToolID>()),
  })),
)
