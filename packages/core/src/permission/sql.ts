import { table, text, uniqueIndex, Timestamps } from "../database/dialect"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import type { PermissionSaved } from "./saved"

export const PermissionTable = table(
  "permission",
  {
    id: text().$type<PermissionSaved.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    resource: text().notNull(),
    ...Timestamps,
  },
  (t) => [uniqueIndex("permission_project_action_resource_idx").on(t.project_id, t.action, t.resource)],
)
