import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { EntityTable } from "./entity.sql"
import { Timestamps } from "./timestamps.sql"

export const RelationTable = sqliteTable(
  "relation",
  {
    id: text().notNull().primaryKey(),
    source_id: text()
      .notNull()
      .references(() => EntityTable.id, { onDelete: "cascade" }),
    target_id: text()
      .notNull()
      .references(() => EntityTable.id, { onDelete: "cascade" }),
    type: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("relation_source_idx").on(table.source_id),
    index("relation_target_idx").on(table.target_id),
    index("relation_type_idx").on(table.type),
    index("relation_source_type_idx").on(table.source_id, table.type),
  ],
)

export type Relation = typeof RelationTable.$inferSelect
export type NewRelation = typeof RelationTable.$inferInsert
