import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    project_path: text().notNull(),
    type: text().notNull(),
    topic: text().notNull(),
    content: text().notNull(),
    session_id: text(),
    access_count: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("memory_project_topic_idx").on(table.project_path, table.topic),
    index("memory_project_idx").on(table.project_path),
    index("memory_type_idx").on(table.type),
  ],
)
