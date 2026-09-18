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

export const ToolResolved = Event.define({
  type: "mcp.tool.resolved",
  schema: {
    sessionID: Schema.String,
    tools: Schema.mutable(Schema.Array(Schema.String)),
  },
})

export const Definitions = Event.inventory(ToolsChanged, BrowserOpenFailed, ToolResolved)
