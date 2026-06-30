export * as McpEvent from "./mcp-event"

import { Schema } from "effect"
import { Event } from "./event"

export const ToolsChanged = Event.define({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})

export const BrowserOpenFailed = Event.define({
  type: "mcp.browser.open.failed",
  schema: {
    mcpName: Schema.String,
    url: Schema.String,
  },
})

// Emitted whenever a server's connection status settles (connected, failed, needs_auth, closed) so
// observers can refresh status without polling.
export const StatusChanged = Event.define({
  type: "mcp.status.changed",
  schema: {
    server: Schema.String,
  },
})

export const Definitions = Event.inventory(ToolsChanged, BrowserOpenFailed, StatusChanged)
