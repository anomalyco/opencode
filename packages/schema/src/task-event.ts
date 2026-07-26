export * as TaskEvent from "./task-event"

import { Schema } from "effect"
import { Event } from "./event"
import { SessionID } from "./session-id"

export const Completed = Event.define({
  type: "task.completed",
  schema: {
    sessionID: SessionID,
    parentSessionID: SessionID,
    status: Schema.Literals(["ok", "error", "aborted"]),
    slug: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    variant: Schema.optional(Schema.String),
    elapsedMs: Schema.optional(Schema.Finite),
    tokens: Schema.optional(
      Schema.Struct({
        input: Schema.optional(Schema.Finite),
        output: Schema.optional(Schema.Finite),
        reasoning: Schema.optional(Schema.Finite),
        cacheRead: Schema.optional(Schema.Finite),
        cacheWrite: Schema.optional(Schema.Finite),
      }),
    ),
    cost: Schema.optional(Schema.Finite),
    result: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  },
})

export const Definitions = Event.inventory(Completed)
