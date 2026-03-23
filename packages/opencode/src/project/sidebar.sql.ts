import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const SidebarTable = sqliteTable("sidebar", {
  worktree: text().primaryKey(),
  sort_order: integer().notNull(),
})
