import { Schema } from "effect"
import { BusEvent } from "../../bus/bus-event"
import { MemoryID, MemoryType } from "./schema"

export const MemoryStored = BusEvent.define(
  "memory.stored",
  Schema.Struct({
    memory_id: MemoryID,
    type: MemoryType,
    tags: Schema.Array(Schema.String),
    importance: Schema.Number,
  }),
)

export const MemoryRecalled = BusEvent.define(
  "memory.recalled",
  Schema.Struct({
    memory_id: MemoryID,
    query: Schema.String,
    relevance_score: Schema.Number,
  }),
)

export const MemoryEvolved = BusEvent.define(
  "memory.evolved",
  Schema.Struct({
    memory_id: MemoryID,
    old_version: Schema.Number.pipe(Schema.int()),
    new_version: Schema.Number.pipe(Schema.int()),
  }),
)

export const MemoryDecayed = BusEvent.define(
  "memory.decayed",
  Schema.Struct({
    memory_id: MemoryID,
    old_importance: Schema.Number,
    new_importance: Schema.Number,
    action: Schema.Literal("decayed", "purged"),
  }),
)

export * as MemoryBusEvents from "./memory-bus-events"
