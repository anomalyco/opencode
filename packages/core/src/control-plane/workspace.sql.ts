import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import { Project } from "../project"
import { Workspace } from "../workspace"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().$type<Workspace.ID>().primaryKey(),
  type: text().notNull(),
  name: text().notNull().default(""),
  branch: text(),
  directory: text(),
  extra: text({ mode: "json" }),
  project_id: text()
    .$type<Project.ID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  time_used: integer()
    .notNull()
    .$default(() => Date.now()),
})
