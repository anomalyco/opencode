import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { statics } from "@opencode-ai/core/schema"

const toolIdSchema = Schema.String.check(Schema.isStartsWith("tool")).pipe(Schema.brand("ToolID"))

export type ToolID = typeof toolIdSchema.Type

export const ToolID = toolIdSchema.pipe(
  statics((schema: typeof toolIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("tool", id)),
  })),
)
