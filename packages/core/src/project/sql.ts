import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { Timestamps } from "../database/schema.sql"
import { ProjectV2 } from "../project"
import { DatabaseDialect } from "../database/dialect"
import { PgProjectTable, PgProjectDirectoryTable } from "./sql.pg"

const _SqliteProjectTable = sqliteTable("project", {
  id: text().$type<ProjectV2.ID>().primaryKey(),
  worktree: DatabasePath.absoluteColumn().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_url_override: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: integer(),
  sandboxes: DatabasePath.absoluteArrayColumn().notNull(),
  commands: text({ mode: "json" }).$type<{ start?: string }>(),
})

const _SqliteProjectDirectoryTable = sqliteTable(
  "project_directory",
  {
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => _SqliteProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] })],
)

type SqliteProjectTable = typeof _SqliteProjectTable
type SqliteProjectDirectoryTable = typeof _SqliteProjectDirectoryTable

export const ProjectTable: SqliteProjectTable = DatabaseDialect.isPostgres() ? PgProjectTable as any : _SqliteProjectTable
export const ProjectDirectoryTable: SqliteProjectDirectoryTable = DatabaseDialect.isPostgres() ? PgProjectDirectoryTable as any : _SqliteProjectDirectoryTable
