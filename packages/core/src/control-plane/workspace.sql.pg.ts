import { pgTable, text, integer, jsonb, bigint } from "drizzle-orm/pg-core"
import { PgProjectTable } from "../project/sql.pg"
import { ProjectV2 } from "../project"
import { WorkspaceV2 } from "../workspace"

export const PgWorkspaceTable = pgTable("workspace", {
  id: text().$type<WorkspaceV2.ID>().primaryKey(),
  type: text().notNull(),
  name: text().notNull().default(""),
  branch: text(),
  directory: text(),
  extra: jsonb(),
  project_id: text()
    .$type<ProjectV2.ID>()
    .notNull()
    .references(() => PgProjectTable.id, { onDelete: "cascade" }),
  time_used: bigint({ mode: "number" })
    .notNull()
    .$default(() => Date.now()),
})
