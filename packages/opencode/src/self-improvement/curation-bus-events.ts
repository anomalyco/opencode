import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { MemoryID, MemoryType } from "./schema"

export const CurationStarted = BusEvent.define(
  "curation.started",
  Schema.Struct({
    run_id: Schema.String,
    type: Schema.Literals(["consolidation", "evolution", "decay", "pattern"]),
    time_started: Schema.Int,
  }),
)

export const CurationEnded = BusEvent.define(
  "curation.ended",
  Schema.Struct({
    run_id: Schema.String,
    type: Schema.Literals(["consolidation", "evolution", "decay", "pattern"]),
    memories_affected: Schema.Int,
    time_completed: Schema.Int,
  }),
)

export const CurationError = BusEvent.define(
  "curation.error",
  Schema.Struct({
    run_id: Schema.String,
    type: Schema.Literals(["consolidation", "evolution", "decay", "pattern"]),
    error: Schema.String,
  }),
)

export * as CurationBusEvents from "./curation-bus-events"
