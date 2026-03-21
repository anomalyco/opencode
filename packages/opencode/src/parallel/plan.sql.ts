import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { PlanID, PlanStatus, ModelRef, PlanError, Subtask, WorkerState, PublishMode, SharedContract, ProjectConventions } from "./schema"
import type { SessionID } from "../session/schema"
import type { ProjectID } from "../project/schema"

export const PlanTable = sqliteTable(
  "plan",
  {
    id: text().$type<PlanID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    status: text().$type<PlanStatus>().notNull(),
    error: text({ mode: "json" }).$type<PlanError | null>(),
    task: text().notNull(),
    orchestrator_model: text({ mode: "json" }).notNull().$type<ModelRef>(),
    worker_model: text({ mode: "json" }).notNull().$type<ModelRef>(),
    subtasks: text({ mode: "json" }).notNull().$type<Subtask[]>(),
    workers: text({ mode: "json" }).notNull().$type<WorkerState[]>(),
    shared_contracts: text({ mode: "json" }).$type<SharedContract[] | null>(),
    conventions: text({ mode: "json" }).$type<ProjectConventions | null>(),
    integration_branch: text(),
    publish_mode: text().$type<PublishMode>(),
    version: integer().notNull().default(0),
    ...Timestamps,
    time_approved: integer(),
    time_completed: integer(),
  },
  (table) => [
    index("plan_project_idx").on(table.project_id),
    index("plan_session_idx").on(table.session_id),
    index("plan_status_idx").on(table.status),
    index("plan_project_status_idx").on(table.project_id, table.status),
  ],
)
