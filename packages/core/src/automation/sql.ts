import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Schema } from "effect"
import type { Automation } from "@opencode/schema/automation"
import { Timestamps } from "../database/schema.sql.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { SessionTable } from "../session/sql.js"

export const AutomationTable = sqliteTable(
  "automation",
  {
    id: text().$type<Automation.ID>().primaryKey(),
    /** The Session a prompt action wakes. */
    session_id: text()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text(),
    action: text({ mode: "json" }).$type<Automation.Action>().notNull(),
    check: text({ mode: "json" }).$type<Automation.StoredCheck>(),
    when: text({ mode: "json" }).$type<Automation.When>().notNull(),
    tz: text().notNull(),
    status: text().$type<Automation.Status>().notNull().default("active"),
    next_due_at: integer(),
    ends_at: integer(),
    remaining_runs: integer(),
    run_count: integer().notNull().default(0),
    checks: integer().notNull().default(0),
    failures: integer().notNull().default(0),
    last_fired_at: integer(),
    last_message_id: text().$type<SessionMessage.ID>(),
    last_outcome: text().$type<Automation.Outcome>(),
    /** The loop leaves a due row alone until then, e.g. while its location has automations turned off. */
    retry_at: integer(),
    /** Condition state persisted across checks (e.g. previous stdout for shell `changes`). */
    state: text({ mode: "json" }).$type<Schema.Json>(),
    ...Timestamps,
  },
  (table) => [
    index("automation_session_idx").on(table.session_id),
    index("automation_due_idx")
      .on(table.next_due_at)
      .where(sql`${table.status} = 'active' and ${table.next_due_at} is not null`),
  ],
)
