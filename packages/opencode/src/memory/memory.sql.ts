import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().primaryKey(),
    project_path: text().notNull(),
    topic: text().notNull(),
    type: text().notNull(),
    content: text().notNull(),
    session_id: text(),
    access_count: integer().default(0),
    scope: text().notNull().default("project"),
    description: text(),
    agent: text(),
    relevance_score: real().notNull().default(1.0),
    time_last_verified: integer(),
    promoted_from: text(),
    ...Timestamps,
  },
  (table) => [
    index("memory_project_path_idx").on(table.project_path),
    index("memory_type_idx").on(table.type),
    index("memory_agent_idx").on(table.agent),
    index("memory_scope_idx").on(table.scope),
    index("memory_project_scope_idx").on(table.project_path, table.scope),
  ],
)
