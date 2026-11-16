import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Schema } from "effect"
import type { Automation } from "@opencode/schema/automation"
import type { ProjectID } from "@opencode/schema/project-id"
import { Timestamps } from "../database/schema.sql.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"

export const AutomationTable = sqliteTable(
  "automation",
  {
    id: text().$type<Automation.ID>().primaryKey(),
    project_id: text().$type<ProjectID>().notNull(),
    /** The Session that created it. No foreign key: deleting that Session keeps the automation. */
    session_id: text().$type<SessionSchema.ID>(),
    /** Where it runs, recorded at creation. */
    directory: text().notNull(),
    name: text().notNull(),
    trigger: text({ mode: "json" }).$type<Automation.Trigger>().notNull(),
    tz: text().notNull(),
    action: text({ mode: "json" }).$type<Automation.Action>().notNull(),
    status: text().$type<Automation.Status>().notNull().default("active"),
    next_due_at: integer(),
    expires_at: integer(),
    run_count: integer().notNull().default(0),
    failures: integer().notNull().default(0),
    last_run_at: integer(),
    last_message_id: text().$type<SessionMessage.ID>(),
    last_outcome: text().$type<Automation.Outcome>(),
    last_output: text(),
    /** The loop leaves a due row alone until then, e.g. while its location has automations turned off. */
    retry_at: integer(),
    /** Code action state persisted across runs. */
    state: text({ mode: "json" }).$type<Schema.Json>(),
    ...Timestamps,
  },
  (table) => [
    index("automation_project_idx").on(table.project_id),
    index("automation_session_idx").on(table.session_id),
    index("automation_due_idx")
      .on(table.next_due_at)
      .where(sql`${table.status} = 'active' and ${table.next_due_at} is not null`),
  ],
)
