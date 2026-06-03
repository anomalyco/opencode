import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import type { EventV2 } from "../event"
import { DatabaseDialect } from "../database/dialect"
import { PgEventSequenceTable, PgEventTable } from "./sql.pg"

const _SqliteEventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})

const _SqliteEventTable = sqliteTable("event", {
  id: text().$type<EventV2.ID>().primaryKey(),
  aggregate_id: text()
    .notNull()
    .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
  seq: integer().notNull(),
  type: text().notNull(),
  data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
})

type SqliteEventSequenceTable = typeof _SqliteEventSequenceTable
type SqliteEventTable = typeof _SqliteEventTable

export const EventSequenceTable: SqliteEventSequenceTable = DatabaseDialect.isPostgres() ? PgEventSequenceTable as any : _SqliteEventSequenceTable
export const EventTable: SqliteEventTable = DatabaseDialect.isPostgres() ? PgEventTable as any : _SqliteEventTable
