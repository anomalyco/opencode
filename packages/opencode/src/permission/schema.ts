import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

const permissionIdSchema = Schema.String.pipe(Schema.brand("PermissionID"))

export type PermissionID = typeof permissionIdSchema.Type

export const PermissionID = permissionIdSchema.pipe(
  withStatics((schema: typeof permissionIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("permission", id)),
    zod: Identifier.schema("permission").pipe(z.custom<PermissionID>()),
  })),
)
