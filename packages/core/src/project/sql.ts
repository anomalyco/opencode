import { table, text, integer, primaryKey, Timestamps } from "../database/dialect"
import * as DatabasePath from "../database/path"
import { ProjectV2 } from "../project"

const ProjectTable = table("project", {
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

const ProjectDirectoryTable = table(
  "project_directory",
  {
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    type: text().$type<"main" | "root" | "git_worktree">().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (t) => [primaryKey({ columns: [t.project_id, t.directory] })],
)

export { ProjectTable, ProjectDirectoryTable }
