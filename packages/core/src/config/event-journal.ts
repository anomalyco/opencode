export * as ConfigEventJournal from "./event-journal"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.EventJournal")({
  retention_hours: PositiveInt.pipe(Schema.optional).annotate({
    description: "Delete journal events for sessions idle longer than this many hours",
  }),
  compact_idle_minutes: PositiveInt.pipe(Schema.optional).annotate({
    description: "Compact redundant part.updated journal events for sessions idle longer than this many minutes",
  }),
  disabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Disable the periodic event journal retention sweep",
  }),
}) {}
