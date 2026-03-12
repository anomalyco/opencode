import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

const toolIdSchema = Schema.String.pipe(Schema.brand("ToolID"))

export type ToolID = typeof toolIdSchema.Type

export const ToolID = toolIdSchema.pipe(
  withStatics((schema: typeof toolIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("tool", id)),
    zod: Identifier.schema("tool").pipe(z.custom<ToolID>()),
  })),
)
