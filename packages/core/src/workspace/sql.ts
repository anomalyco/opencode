import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { Workspace } from "@opencode-ai/schema/workspace"
import type { WorkspaceDriver } from "./driver"

export const WorkspaceTable = sqliteTable("workspace", {
  id: text().$type<Workspace.ID>().primaryKey(),
  provider: text().notNull(),
  binding: text({ mode: "json" }).$type<WorkspaceDriver.Binding>().notNull(),
  root: text().notNull(),
  ...Timestamps,
})
