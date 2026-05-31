import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "./timestamps.sql"

export const EntityTable = sqliteTable(
  "entity",
  {
    id: text().notNull().primaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text(),
    content: text({ mode: "json" }).$type<Record<string, unknown>>(),
    embedding: text(),
    ...Timestamps,
  },
  (table) => [index("entity_type_idx").on(table.type), index("entity_name_idx").on(table.name)],
)

export type Entity = typeof EntityTable.$inferSelect
export type NewEntity = typeof EntityTable.$inferInsert
