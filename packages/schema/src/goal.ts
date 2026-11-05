export * as Goal from "./goal.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

export const Status = Schema.Literals(["active", "paused", "complete"])
export type Status = typeof Status.Type

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  id: Schema.String,
  objective: Schema.String,
  status: Status,
  /** Why the goal last changed: the reviewer's reason, or what paused it. */
  reason: optional(Schema.String),
  /** Continuations sent since the goal was set or last resumed. */
  rounds: Schema.Number,
  /** A backstop for loops that stall detection misses. */
  maxRounds: Schema.Number,
  /** Rounds in a row without progress: no tool calls, or the same reason as the round before. */
  stalls: optional(Schema.Number),
  /** The server process that armed the goal. */
  boot: Schema.String,
  updatedAt: Schema.Number,
}).annotate({ identifier: "Goal.State" })

/**
 * The `/goal` plugin's RPC. Clients read a Session's goal with `get` and keep it current from `changed`, which the
 * plugin publishes in the Session's Location on every write. A Session's goal is its own: children and forks start
 * without one. The schemas are Standard Schemas too, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "opencode.goal",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(Schema.NullOr(State)),
    },
  },
  events: {
    changed: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, goal: Schema.NullOr(State) })),
    },
  },
})
