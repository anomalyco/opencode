import { Workspace } from "@opencode-ai/schema/workspace"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { WorkspaceDriver } from "./driver.js"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().$type<Workspace.ID>().primaryKey(),
  provider: text().notNull(),
  binding: text({ mode: "json" }).$type<WorkspaceDriver.Binding>(),
  created_at: integer().notNull(),
  last_used_at: integer().notNull(),
})
