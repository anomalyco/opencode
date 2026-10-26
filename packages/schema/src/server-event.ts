export * as ServerEvent from "./server-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"

export const Connected = Event.ephemeral({
  type: "server.connected",
  schema: {
    connection: optional(Schema.String),
  },
})
export const Disposed = Event.ephemeral({ type: "global.disposed", schema: {} })

export const Definitions = Event.inventory(Connected, Disposed)
