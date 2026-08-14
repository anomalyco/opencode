export * as WorkspaceV2 from "./workspace"

import { Workspace } from "@moks/schema/workspace"

export const ID = Workspace.ID
export type ID = typeof ID.Type
