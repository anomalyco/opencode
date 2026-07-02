export * as EventLog from "./event-log.js"

import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"

/**
 * Replay-to-live boundary marker for a durable log read. The reader now holds
 * every event committed at or below `seq`; `seq` is absent when the log holds
 * no events at or before the read position. May be re-emitted after the
 * reader internally re-attaches.
 */
export const CaughtUp = Schema.Struct({
  type: Schema.Literal("log.caught_up"),
  aggregateID: Schema.String,
  seq: optional(Event.Seq),
}).annotate({
  identifier: "EventLog.CaughtUp",
  description:
    "Marker emitted when a log read transitions from replay to live (or completes a finite read). The reader holds every event committed at or below seq.",
})
export interface CaughtUp extends Schema.Schema.Type<typeof CaughtUp> {}

/**
 * A payload-free doorbell: the aggregate's log advanced to at least `seq`.
 * Hints are a latency optimization only; no consumer may derive correctness
 * from receiving one. Correctness always comes from a durable log read plus
 * the consumer's own checkpoint.
 */
export const Hint = Schema.Struct({
  type: Schema.Literal("log.hint"),
  aggregateID: Schema.String,
  seq: Event.Seq,
}).annotate({
  identifier: "EventLog.Hint",
  description:
    "Payload-free change hint: the aggregate's durable log advanced to at least seq. Hints coalesce under backpressure (latest per aggregate) and are never a delivery guarantee.",
})
export interface Hint extends Schema.Schema.Type<typeof Hint> {}

/**
 * Hints may have been lost. Treat every aggregate as potentially dirty and
 * recover via bounded sweep plus durable log reads. Also emitted first on
 * every (re)subscribe, since hints during disconnection were never buffered.
 */
export const SweepRequired = Schema.Struct({
  type: Schema.Literal("log.sweep_required"),
}).annotate({
  identifier: "EventLog.SweepRequired",
  description:
    "Hints may have been lost; treat every aggregate as potentially dirty and recover via bounded sweep plus durable log reads. Emitted first on every (re)subscribe.",
})
export interface SweepRequired extends Schema.Schema.Type<typeof SweepRequired> {}

export const Change = Schema.Union([Hint, SweepRequired]).annotate({ identifier: "EventLog.Change" })
export type Change = typeof Change.Type
