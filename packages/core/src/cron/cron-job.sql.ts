import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const CronJobTable = sqliteTable("cron_job", {
  id: text().primaryKey(),
  name: text(),
  prompt: text().notNull(),
  schedule_kind: text().notNull(),
  schedule_expr: text().notNull(),
  enabled: integer().notNull().default(1),
  state: text().notNull().default("scheduled"),
  next_run_at: integer(),
  last_run_at: integer(),
  last_status: text(),
  last_error: text(),
  model: text(),
  skills: text(),
  workdir: text(),
  repeat_times: integer(),
  repeat_done: integer().notNull().default(0),
  ...Timestamps,
})
