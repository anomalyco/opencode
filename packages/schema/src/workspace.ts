export * as Workspace from "./workspace.js"

import { Schema } from "effect"
import { WorkspaceEvent } from "./workspace-event.js"
import { WorkspaceID } from "./workspace-id.js"

export const ID = WorkspaceID
export type ID = WorkspaceID

export const DestroyResult = Schema.Struct({
  destroyed: Schema.Boolean.annotate({
    description: "True when this request transitioned the workspace from existing to destroyed.",
  }),
}).annotate({
  identifier: "WorkspaceDestroyResult",
  description: "Reports whether this request destroyed an existing workspace.",
})
export interface DestroyResult extends Schema.Schema.Type<typeof DestroyResult> {}

export const Event = WorkspaceEvent
