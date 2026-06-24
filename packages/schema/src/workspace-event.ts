export * as WorkspaceEvent from "./workspace-event"

import { Schema } from "effect"
import { Event } from "./event"
import { Workspace } from "./workspace"

export const ConnectionStatus = Schema.Struct({
  workspaceID: Workspace.ID,
  status: Schema.Literals(["connected", "connecting", "disconnected", "error"]),
})
export type ConnectionStatus = typeof ConnectionStatus.Type

export const Ready = Event.define({
  type: "workspace.ready",
  schema: {
    name: Schema.String,
  },
})

export const Failed = Event.define({
  type: "workspace.failed",
  schema: {
    message: Schema.String,
  },
})

export const Status = Event.define({
  type: "workspace.status",
  schema: ConnectionStatus.fields,
})
