import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import type { Config } from "./config"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().primaryKey(),
  branch: text(),
  project_id: text()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  config: text({ mode: "json" }).notNull().$type<Config>(),
})
