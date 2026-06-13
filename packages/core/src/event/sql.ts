import { table, text, integer } from "../database/dialect"
import type { EventV2 } from "../event"

const EventSequenceTable = table("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})

const EventTable = table("event", {
  id: text().$type<EventV2.ID>().primaryKey(),
  aggregate_id: text()
    .notNull()
    .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  type: text().notNull(),
  data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
})

export { EventSequenceTable, EventTable }
