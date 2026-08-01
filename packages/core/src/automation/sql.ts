import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
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
    ...Timestamps,
  },
  (table) => [
    index("automation_trigger_session_idx").on(table.session_id),
    index("automation_trigger_enabled_idx").on(table.enabled),
  ],
)
