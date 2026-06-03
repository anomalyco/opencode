import { pgTable, text, integer, jsonb } from "drizzle-orm/pg-core"
import type { EventV2 } from "../event"

export const PgEventSequenceTable = pgTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})

export const PgEventTable = pgTable("event", {
  id: text().$type<EventV2.ID>().primaryKey(),
  aggregate_id: text()
    .notNull()
    .references(() => PgEventSequenceTable.aggregate_id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  type: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
})
