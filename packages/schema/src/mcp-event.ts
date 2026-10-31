export * as McpEvent from "./mcp-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"

export const ToolsChanged = Event.ephemeral({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})

export const ResourcesChanged = Event.ephemeral({
  type: "mcp.resources.changed",
  schema: {
    server: Schema.String,
  },
})

// A subscribed resource changed. `text` is the fresh resources/read.
export const ResourceUpdated = Event.ephemeral({
  type: "mcp.resource.updated",
  schema: {
    server: Schema.String,
    uri: Schema.String,
    text: optional(Schema.String),
  },
})

// Emitted whenever a server's connection status settles (connected, failed, needs_auth, closed) so
// observers can refresh status without polling.
export const StatusChanged = Event.ephemeral({
  type: "mcp.status.changed",
  schema: {
    server: Schema.String,
  },
})

export const Definitions = Event.inventory(ToolsChanged, ResourcesChanged, ResourceUpdated, StatusChanged)
