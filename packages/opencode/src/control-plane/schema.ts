import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { withStatics } from "@opencode-ai/core/schema"

export const WorkspaceID = WorkspaceV2.ID.pipe(
  withStatics((schema: typeof WorkspaceV2.ID) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("workspace", id)),
  })),
)
export type WorkspaceID = typeof WorkspaceID.Type
