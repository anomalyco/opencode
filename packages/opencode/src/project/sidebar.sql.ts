import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const ProjectSidebarTable = sqliteTable("project_sidebar", {
  worktree: text().primaryKey(),
  sort_order: integer().notNull(),
})
