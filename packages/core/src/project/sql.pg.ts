import { pgTable, text, bigint, jsonb, primaryKey, integer } from "drizzle-orm/pg-core"
import * as DatabasePath from "../database/path.pg"
import { PgTimestamps } from "../database/schema.pg"
import { ProjectV2 } from "../project"

export const PgProjectTable = pgTable("project", {
  id: text().$type<ProjectV2.ID>().primaryKey(),
  worktree: DatabasePath.pgAbsoluteColumn().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_url_override: text(),
  icon_color: text(),
  ...PgTimestamps,
  time_initialized: bigint({ mode: "number" }),
  sandboxes: DatabasePath.pgAbsoluteArrayColumn().notNull(),
  commands: jsonb().$type<{ start?: string }>(),
})

export const PgProjectDirectoryTable = pgTable(
  "project_directory",
  {
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => PgProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">().notNull(),
    time_created: bigint({ mode: "number" })
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] })],
)
