import { sql } from "drizzle-orm"
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { EventV2 } from "../event"

export const EventSequenceTable = sqliteTable("event_sequence", {
  aggregate_id: text().notNull().primaryKey(),
  seq: integer().notNull(),
  owner_id: text(),
})

export const EventTable = sqliteTable(
  "event",
  {
    id: text().$type<EventV2.ID>().primaryKey(),
    aggregate_id: text()
      .notNull()
      .references(() => EventSequenceTable.aggregate_id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    type: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    // Non-null once the payload was superseded by a newer diff event. The digest of the
    // original payload keeps replay idempotent after `data` shrinks to a tombstone.
    tombstone_digest: text(),
  },
  (table) => [
    uniqueIndex("event_aggregate_seq_idx").on(table.aggregate_id, table.seq),
    index("event_aggregate_type_seq_idx").on(table.aggregate_id, table.type, table.seq),
    // Expression index so `tombstoneDiffEvents` (projector) can seek diff rows by
    // messageID instead of JSON-parsing every event in the session (O(N²) today).
    // `aggregate_id` leads because every motivating query filters on it, so the index
    // actually applies under SQLite's leftmost-prefix rule.
    index("event_message_id_idx").on(table.aggregate_id, sql`json_extract(${table.data}, '$.messageID')`),
  ],
)
