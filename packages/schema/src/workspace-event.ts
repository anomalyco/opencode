export * as WorkspaceEvent from "./workspace-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { WorkspaceID } from "./workspace-id.js"

export const ConnectionStatus = Schema.Struct({
  workspaceID: WorkspaceID,
  status: Schema.Literals(["connected", "connecting", "disconnected", "error"]),
}).annotate({ identifier: "WorkspaceEvent.ConnectionStatus" })
export interface ConnectionStatus extends Schema.Schema.Type<typeof ConnectionStatus> {}

export const Ready = Event.ephemeral({
  type: "workspace.ready",
  schema: {
    name: Schema.String,
  },
})

export const Failed = Event.ephemeral({
  type: "workspace.failed",
  schema: {
    message: Schema.String,
  },
})

export const Status = Event.ephemeral({
  type: "workspace.status",
  schema: ConnectionStatus.fields,
})

export const Definitions = Event.inventory(Ready, Failed, Status)
