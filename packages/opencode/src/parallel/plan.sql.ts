import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { PlanID, PlanStatus, ModelRef, Subtask, WorkerState } from "./schema"
import type { SessionID } from "../session/schema"

export const PlanTable = sqliteTable(
  "plan",
  {
    id: text().$type<PlanID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    status: text().$type<PlanStatus>().notNull(),
    task: text().notNull(),
    orchestrator_model: text({ mode: "json" }).notNull().$type<ModelRef>(),
    worker_model: text({ mode: "json" }).notNull().$type<ModelRef>(),
    subtasks: text({ mode: "json" }).notNull().$type<Subtask[]>(),
    workers: text({ mode: "json" }).notNull().$type<WorkerState[]>(),
    ...Timestamps,
    time_approved: integer(),
    time_completed: integer(),
  },
  (table) => [index("plan_session_idx").on(table.session_id), index("plan_status_idx").on(table.status)],
)
