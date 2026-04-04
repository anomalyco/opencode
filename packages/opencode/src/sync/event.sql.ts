import { table as sqliteTable, text, integer } from "../storage/dialect"

export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
})

export const EventTable = sqliteTable("event", {
  id: text().primaryKey(),
  aggregate_id: text()
    .notNull()
    .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  type: text().notNull(),
  data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
})
