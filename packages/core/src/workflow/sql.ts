import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/sql"
import { Timestamps } from "../database/schema.sql"
import type { Workflow } from "@opencode-ai/schema/workflow"
import type { DeepMutable } from "../schema"

export const WorkflowPreferenceTable = sqliteTable("workflow_preference", {
  project_id: text()
    .$type<Workflow.Preferences["projectID"]>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  architect: text({ mode: "json" }).$type<Workflow.RoleSelection>(),
  coder: text({ mode: "json" }).$type<Workflow.RoleSelection>(),
  concurrency: integer(),
  ...Timestamps,
})

export const WorkflowTable = sqliteTable(
  "workflow",
  {
    id: text().$type<Workflow.ID>().primaryKey(),
    project_id: text()
      .$type<Workflow.Info["projectID"]>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    story: text().notNull(),
    status: text().$type<Workflow.Status>().notNull(),
    architect: text({ mode: "json" }).$type<Workflow.RoleSelection>().notNull(),
    coder: text({ mode: "json" }).$type<Workflow.RoleSelection>().notNull(),
    concurrency: integer().notNull(),
    tasks: text({ mode: "json" }).$type<DeepMutable<Workflow.Task>[]>().notNull(),
    attempts: text({ mode: "json" }).$type<DeepMutable<Workflow.Attempt>[]>().notNull(),
    sessions: text({ mode: "json" }).$type<DeepMutable<Workflow.Info["sessions"]>>().notNull(),
    branch: text(),
    ...Timestamps,
  },
  (table) => [index("workflow_project_status_idx").on(table.project_id, table.status)],
)
