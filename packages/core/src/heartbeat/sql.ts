import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"

export type HeartbeatStatus = "scheduled" | "firing" | "fired" | "cancelled" | "error"

export const HeartbeatTable = sqliteTable(
  "heartbeat",
  {
    job_id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    task: text().notNull(),
    directory: text().notNull(),
    agent: text().notNull(),
    status: text().$type<HeartbeatStatus>().notNull(),
    revision: integer().notNull(),
    check_number: integer().notNull(),
    max_checks: integer().notNull(),
    delay_seconds: integer().notNull(),
    initial_delay_seconds: integer().notNull(),
    interval_seconds: integer().notNull(),
    backoff: text().$type<"fixed" | "linear" | "exponential">().notNull(),
    max_interval_seconds: integer().notNull(),
    next_delay_seconds: integer().notNull(),
    scheduled_at: integer().notNull(),
    fires_at: integer().notNull(),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("heartbeat_session_task_idx").on(table.session_id, table.task),
    index("heartbeat_status_fires_idx").on(table.status, table.fires_at),
  ],
)
