import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
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
    // Index for polling pending tasks
    // Index for looking up tasks by status
    // Index for looking up tasks by repo
  ]
)

export const TeamJulesWorkerTable = sqliteTable("teamjules_worker", {
  id: text().primaryKey(),
  status: text({ enum: ["idle", "busy", "offline"] })
    .notNull()
    .default("idle"),
  last_heartbeat: integer().notNull(),
  ...Timestamps,
})
