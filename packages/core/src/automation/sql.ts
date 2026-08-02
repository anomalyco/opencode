import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"
import { Timestamps } from "../database/schema.sql"

export type Schedule =
  | { readonly type: "cron"; readonly expression: string }
  | { readonly type: "webhook"; readonly path: string; readonly secret?: string }

export const AutomationTriggerTable = sqliteTable(
  "automation_trigger",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    prompt: text().notNull(),
    schedule: text({ mode: "json" }).notNull().$type<Schedule>(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    agent: text(),
    last_fired: integer(),
    locked: integer({ mode: "boolean" }).notNull().default(false),
    lock_owner: text(),
    lock_expires: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_trigger_session_idx").on(table.session_id),
    index("automation_trigger_enabled_idx").on(table.enabled),
    index("automation_trigger_locked_idx").on(table.locked),
  ],
)

export const AutomationRunTable = sqliteTable(
  "automation_run",
  {
    id: text().primaryKey(),
    trigger_id: text()
      .notNull()
      .references(() => AutomationTriggerTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull(),
    status: text({ enum: ["pending", "running", "completed", "failed", "cancelled"] }).notNull(),
    prompt: text().notNull(),
    agent: text(),
    error: text(),
    payload: text({ mode: "json" }),
    time_started: integer().notNull(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_run_trigger_idx").on(table.trigger_id),
    index("automation_run_session_idx").on(table.session_id),
    index("automation_run_status_idx").on(table.status),
    index("automation_run_time_idx").on(table.time_started),
  ],
)
