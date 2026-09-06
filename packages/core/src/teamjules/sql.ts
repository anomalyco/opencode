import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const TeamJulesTaskTable = sqliteTable(
  "teamjules_task",
  {
    id: text().primaryKey(),
    type: text({ enum: ["issue", "pr", "manual"] })
      .notNull()
      .default("manual"),
    status: text({
      enum: ["pending", "queued", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    repo: text().notNull(),
    branch: text().notNull(),
    prompt: text().notNull(),
    result: text({ mode: "json" }),
    session_id: text(),
    worker_id: text(),
    attempt_count: integer()
      .notNull()
      .default(0),
    max_attempts: integer()
      .notNull()
      .default(3),
    ...Timestamps,
  },
  (table) => [
    index("teamjules_task_status_created_idx").on(table.status, table.time_created),
    index("teamjules_task_repo_idx").on(table.repo),
    index("teamjules_task_worker_idx").on(table.worker_id),
  ],
)

export const TeamJulesWorkerTable = sqliteTable(
  "teamjules_worker",
  {
    id: text().primaryKey(),
    status: text({ enum: ["idle", "busy", "offline"] })
      .notNull()
      .default("idle"),
    last_heartbeat: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("teamjules_worker_status_heartbeat_idx").on(table.status, table.last_heartbeat),
  ],
)

