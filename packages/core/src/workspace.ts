export * as WorkspaceV2 from "./workspace"

import { Workspace } from "@leak-code/schema/workspace"

export const ID = Workspace.ID
export type ID = typeof ID.Type
