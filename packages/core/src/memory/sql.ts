import { sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import { Timestamps } from "../database/schema.sql"
import type { ProjectV2 } from "../project"
import type { SessionSchema } from "../session/schema"
import type { MemorySchema } from "./schema"

export const MemoryTable = sqliteTable(
  "memory",
  {
    id: text().$type<MemorySchema.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    source: text().$type<"auto" | "manual">().notNull(),
    session_id: text().$type<SessionSchema.ID>(),
    ...Timestamps,
  },
  (table) => [
    index("memory_project_idx").on(table.project_id),
    index("memory_project_source_idx").on(table.project_id, table.source),
  ],
)
