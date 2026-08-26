import type { EffectDrizzleSqlite } from "../database/drizzle.js"
import { isNotNull, isNull, ne, or } from "drizzle-orm"
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core"
import { absoluteArrayColumn, absoluteColumn } from "../database/path.js"
import { Timestamps } from "../database/schema.sql.js"
import type { AbsolutePath } from "../schema.js"
import { ProjectSchema } from "./schema.js"

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export const ProjectTable = sqliteTable("project", {
  id: text().$type<ProjectSchema.ID>().primaryKey(),
  worktree: absoluteColumn().notNull(),
  vcs: text().$type<ProjectSchema.Vcs["type"]>(),
  name: text(),
  icon_url: text(),
  icon_url_override: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: integer(),
  sandboxes: absoluteArrayColumn().notNull(),
  commands: text({ mode: "json" }).$type<{ start?: string }>(),
})

/** @deprecated Use WorktreeTable from worktree/sql instead. */
export const ProjectDirectoryTable = sqliteTable(
  "project_directory",
  {
    project_id: text()
      .$type<ProjectSchema.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: absoluteColumn().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">(),
    strategy: text(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.directory] })],
)

export function upsertProject(
  db: DatabaseClient | Transaction,
  project: { readonly id: ProjectSchema.ID; readonly canonical: AbsolutePath; readonly vcs?: ProjectSchema.Vcs },
) {
  const vcs = project.vcs?.type
  return db
    .insert(ProjectTable)
    .values({ id: project.id, worktree: project.canonical, vcs, sandboxes: [] })
    .onConflictDoUpdate({
      target: ProjectTable.id,
      set: { worktree: project.canonical, vcs: vcs ?? null },
      setWhere: or(
        ne(ProjectTable.worktree, project.canonical),
        vcs ? or(isNull(ProjectTable.vcs), ne(ProjectTable.vcs, vcs)) : isNotNull(ProjectTable.vcs),
      ),
    })
    .run()
}
