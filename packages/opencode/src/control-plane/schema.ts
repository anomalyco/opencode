import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"

const workspaceIdSchema = Schema.String.check(Schema.isStartsWith("wrk"))
  .annotate({ [ZodOverride]: Identifier.schema("workspace") })
  .pipe(Schema.brand("WorkspaceID"))

export type WorkspaceID = typeof workspaceIdSchema.Type

export const WorkspaceID = workspaceIdSchema.pipe(
  withStatics((schema: typeof workspaceIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("workspace", id)),
    zod: zod(schema),
  })),
)
