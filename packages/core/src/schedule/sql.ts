import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
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
    when: text({ mode: "json" }).$type<Schedule.When>().notNull(),
    tz: text().notNull(),
    status: text().$type<Schedule.Status>().notNull().default("active"),
    next_due_at: integer(),
    ends_at: integer(),
    remaining_runs: integer(),
    run_count: integer().notNull().default(0),
    last_fired_at: integer(),
    last_message_id: text().$type<SessionMessage.ID>(),
    last_outcome: text().$type<Schedule.Outcome>(),
    /** The loop leaves a due row alone until then, e.g. while its location has schedules turned off. */
    retry_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("schedule_session_idx").on(table.session_id),
    index("schedule_due_idx")
      .on(table.next_due_at)
      .where(sql`${table.status} = 'active' and ${table.next_due_at} is not null`),
  ],
)
