export * as Workspace from "./workspace.js"

import { WorkspaceEvent } from "./workspace-event.js"
import { WorkspaceID } from "./workspace-id.js"

export const ID = WorkspaceID
export type ID = WorkspaceID

export const Event = WorkspaceEvent
