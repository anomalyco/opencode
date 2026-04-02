import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    scope: text().notNull(), // "user" | "project"
    project_id: text(), // null for user-scoped
    type: text().notNull(), // "user" | "feedback" | "project" | "reference"
    title: text().notNull(),
    content: text().notNull(),
    tags: text({ mode: "json" }).$type<string[]>(),
    file: text().notNull(), // relative path to the .md file
    ...Timestamps,
  },
  (table) => [
    index("memory_scope_idx").on(table.scope),
    index("memory_project_idx").on(table.project_id),
    index("memory_type_idx").on(table.type),
  ],
)
