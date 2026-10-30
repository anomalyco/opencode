import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Trading } from "@opencode/schema/trading"
import { Timestamps } from "../database/schema.sql.js"

export const TradingTaskTable = sqliteTable("trading_task", {
  id: text().$type<Trading.TaskID>().primaryKey(),
  kind: text().$type<Trading.TaskKind>().notNull(),
  /** System IDs the task acts on, deduplicated and validated against the pool at creation; empty means every system. */
  system_ids: text({ mode: "json" }).$type<string[]>().notNull(),
  /** Epoch ms on the server machine's local (PC) clock. */
  run_at: integer().notNull(),
  status: text().$type<Trading.TaskStatus>().notNull().default("pending"),
  /** Epoch ms when the task fired, was marked missed or was cancelled; null while pending. */
  resolved_at: integer(),
  ...Timestamps,
})
