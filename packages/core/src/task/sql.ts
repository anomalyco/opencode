import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { Task } from "@opencode-ai/schema/task"

export const TaskTable = sqliteTable("task", {
  id: text().$type<Task.ID>().primaryKey(),
  name: text().notNull(),
  command: text().notNull(),
  cwd: text().notNull(),
  status: text().$type<Task.Status>().notNull(),
  pid: integer(),
  port: integer(),
  exit_code: integer(),
  error: text(),
  started_at: integer().notNull(),
  completed_at: integer(),
  metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
})
