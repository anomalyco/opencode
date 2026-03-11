import { Schema } from "effect"
import z from "zod"

import { withStatics } from "@/util/schema"
import { Identifier } from "@/id/id"

const workspaceIdSchema = Schema.String.pipe(Schema.brand("WorkspaceId"))

export type WorkspaceID = typeof workspaceIdSchema.Type

export const WorkspaceID = workspaceIdSchema.pipe(
  withStatics((schema: typeof workspaceIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("workspace", id)),
    zod: z.string().startsWith("wrk").pipe(z.custom<WorkspaceID>()),
  })),
)
