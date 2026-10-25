export * as EventLog from "./event-log.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"

/**
 * Replay-to-live boundary marker for a durable log read. The reader now holds
 * every event committed at or below this watermark; `seq` is absent when the
 * captured watermark is empty. Emitted once for the captured watermark.
 */
export const Synced = Schema.Struct({
  type: Schema.Literal("log.synced"),
  aggregateID: Schema.String,
  seq: optional(Event.Seq),
}).annotate({
  identifier: "EventLog.Synced",
  description:
    "Marker emitted once when a log read reaches its captured watermark. The reader holds every event committed at or below seq.",
})
export interface Synced extends Schema.Schema.Type<typeof Synced> {}
