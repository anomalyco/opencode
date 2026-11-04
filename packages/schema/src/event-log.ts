export * as EventLog from "./event-log.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"

/**
 * Replay-to-live boundary marker for a durable log read. Retained events at or
 * below this watermark have been read; `seq` is absent when the captured
 * watermark is empty. Persistence may have been disabled for part of the history.
 */
export const Synced = Schema.Struct({
  type: Schema.Literal("log.synced"),
  aggregateID: Schema.String,
  seq: optional(Event.Seq),
  persist: optional(
    Schema.Boolean.annotate({
      description:
        "Whether this process retains newly committed durable event payloads. False means following the log cannot deliver new events from this process. True does not guarantee that earlier history was retained. Absent on older servers; treat absence as unknown.",
    }),
  ),
}).annotate({
  identifier: "EventLog.Synced",
  description:
    "Marker emitted once when a log read reaches its captured watermark. The reader holds retained, decodable events at or below seq; the watermark alone does not guarantee complete history.",
})
export interface Synced extends Schema.Schema.Type<typeof Synced> {}
