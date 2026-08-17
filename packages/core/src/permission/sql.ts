import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql.js"
import { Project } from "../project.js"
import { ProjectTable } from "../project/sql.js"
import type { PermissionSaved } from "./saved.js"

export const PermissionTable = sqliteTable(
  "permission",
  {
    id: text().$type<PermissionSaved.ID>().primaryKey(),
    project_id: text()
      .$type<Project.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    resource: text().notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("permission_project_action_resource_idx").on(table.project_id, table.action, table.resource)],
)
