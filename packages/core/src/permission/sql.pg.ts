import { pgTable, text, uniqueIndex, bigint } from "drizzle-orm/pg-core"
import { PgTimestamps } from "../database/schema.pg"
import { ProjectV2 } from "../project"
import { PgProjectTable } from "../project/sql.pg"
import type { PermissionSaved } from "./saved"

export const PgPermissionTable = pgTable(
  "permission",
  {
    id: text().$type<PermissionSaved.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => PgProjectTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    resource: text().notNull(),
    ...PgTimestamps,
  },
  (table) => [uniqueIndex("permission_project_action_resource_idx").on(table.project_id, table.action, table.resource)],
)
