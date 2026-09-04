import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { absoluteColumn } from "../database/path.js"
import { ProjectSchema } from "../project/schema.js"
import { ProjectTable } from "../project/sql.js"

export const WorktreeTable = sqliteTable(
  "worktree",
  {
    project_id: text()
      .$type<ProjectSchema.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: absoluteColumn().notNull(),
    strategy: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] })],
)
