import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const curationLogTable = sqliteTable("curation_run_log", {
  id: text("id").primaryKey(),
  type: text("type").notNull().$type<"consolidation" | "evolution" | "decay" | "pattern">(),
  status: text("status").notNull().default("running").$type<"running" | "completed" | "failed">(),
  stats_json: text("stats_json").notNull().default("{}"),
  error: text("error"),
  memories_affected: integer("memories_affected").notNull().default(0),
  time_started: integer("time_started").notNull(),
  time_completed: integer("time_completed"),
})

export * as SelfImprovementCurationLog from "./curation-log.sql"
