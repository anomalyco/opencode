import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { WorkspaceV2 } from "../workspace"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().$type<WorkspaceV2.ID>().primaryKey(),
  type: text().notNull(),
  name: text().notNull().default(""),
  branch: text(),
  directory: text(),
  extra: text({ mode: "json" }),
  project_id: text()
    .$type<ProjectV2.ID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  time_used: integer()
    .notNull()
    .$default(() => Date.now()),
})
