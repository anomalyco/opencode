export * as McpEvent from "./mcp-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"

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

// Emitted whenever a server's connection status settles (connected, failed, needs_auth, closed) so
// observers can refresh status without polling.
export const StatusChanged = Event.ephemeral({
  type: "mcp.status.changed",
  schema: {
    server: Schema.String,
  },
})

// Experimental: MCP Events is a draft extension; may change without compatibility guarantees.

/** One event from an MCP Events subscription. Delivery is at least once: dedupe on `id` and `eventId`. */
export const ExperimentalEvent = Event.ephemeral({
  type: "experimental.mcp.event",
  schema: {
    /** The subscription that received it. */
    id: Schema.String,
    server: Schema.String,
    name: Schema.String,
    eventId: Schema.String,
    timestamp: Schema.String,
    data: Schema.Json,
    /** Where the subscription resumes from after this event; null when the event type has no replay. */
    cursor: Schema.NullOr(Schema.String),
    /** The server skipped events before this one, which it could not replay. */
    truncated: Schema.optional(Schema.Boolean),
  },
})

/** A subscription's status changed; read it with the MCP service's `subscriptions`. */
export const ExperimentalSubscriptionChanged = Event.ephemeral({
  type: "experimental.mcp.subscription.changed",
  schema: {
    id: Schema.String,
  },
})

export const Definitions = Event.inventory(
  ToolsChanged,
  ResourcesChanged,
  StatusChanged,
  ExperimentalEvent,
  ExperimentalSubscriptionChanged,
)
