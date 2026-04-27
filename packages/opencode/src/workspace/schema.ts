import { Schema } from "effect"

import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const multiRootWorkspaceIdSchema = Schema.String.pipe(Schema.brand("MultiRootWorkspaceID"))

export type MultiRootWorkspaceID = typeof multiRootWorkspaceIdSchema.Type

export const MultiRootWorkspaceID = multiRootWorkspaceIdSchema.pipe(
  withStatics((schema: typeof multiRootWorkspaceIdSchema) => ({
    zod: zod(schema),
  })),
)
