import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Schema } from "effect"
import type { Schedule } from "@opencode/schema/schedule"
import { Timestamps } from "../database/schema.sql.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { SessionTable } from "../session/sql.js"

export const ScheduleTable = sqliteTable(
  "schedule",
  {
    id: text().$type<Schedule.ID>().primaryKey(),
    /** The Session a prompt action wakes. */
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text(),
    action: text({ mode: "json" }).$type<Schedule.Action>().notNull(),
    check: text({ mode: "json" }).$type<Schedule.StoredCheck>(),
    when: text({ mode: "json" }).$type<Schedule.When>().notNull(),
    tz: text().notNull(),
    status: text().$type<Schedule.Status>().notNull().default("active"),
    next_due_at: integer(),
    ends_at: integer(),
    remaining_runs: integer(),
    run_count: integer().notNull().default(0),
    checks: integer().notNull().default(0),
    failures: integer().notNull().default(0),
    last_fired_at: integer(),
    last_message_id: text().$type<SessionMessage.ID>(),
    active_job_id: text(),
    dedicated_session_id: text().$type<SessionSchema.ID>(),
    last_outcome: text().$type<Schedule.Outcome>(),
    /** The loop leaves a due row alone until then, e.g. while its location has schedules turned off. */
    retry_at: integer(),
    /** Condition state persisted across checks (e.g. previous stdout for shell `changes`). */
    state: text({ mode: "json" }).$type<Schema.Json>(),
    ...Timestamps,
  },
  (table) => [
    index("schedule_session_idx").on(table.session_id),
    index("schedule_due_idx")
      .on(table.next_due_at)
      .where(sql`${table.status} = 'active' and ${table.next_due_at} is not null`),
  ],
)

export const ScheduleRunTable = sqliteTable(
  "schedule_run",
  {
    id: text().$type<Schedule.RunID>().primaryKey(),
    schedule_id: text()
      .$type<Schedule.ID>()
      .notNull()
      .references(() => ScheduleTable.id, { onDelete: "cascade" }),
    schedule_name: text(),
    owner_session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>(),
    run: integer().notNull(),
    status: text().$type<Schedule.RunStatus>().notNull(),
    attention: text().$type<Schedule.Attention>().notNull().default("quiet"),
    summary: text(),
    error: text(),
    reported_attention: text().$type<Schedule.Attention>(),
    reported_summary: text(),
    next_in_ms: integer(),
    started_at: integer().notNull(),
    completed_at: integer(),
    read_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("schedule_run_schedule_idx").on(table.schedule_id, table.started_at),
    index("schedule_run_session_running_idx")
      .on(table.session_id)
      .where(sql`${table.status} = 'running' and ${table.session_id} is not null`),
    index("schedule_run_inbox_idx")
      .on(table.owner_session_id, table.started_at)
      .where(sql`${table.attention} in ('ready', 'needs_you') and ${table.read_at} is null`),
  ],
)
