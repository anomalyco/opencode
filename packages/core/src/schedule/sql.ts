import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const ScheduleTable = sqliteTable("zero_schedule", {
  id: text("id").primaryKey(),
  cron: text("cron").notNull(), // Cron format "*/5 * * * *" or ISO time
  command: text("command").notNull(), // Bash command to be executed
  last_run: integer("last_run"),
  next_run: integer("next_run").notNull(),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  ...Timestamps,
})
