import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().primaryKey(),
  type: text().notNull(),
  branch: text(),
  name: text(),
  directory: text(),
  extra: text({ mode: "json" }),
  project_id: text()
    .$type<ProjectID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
})
