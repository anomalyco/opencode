import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import type { AutomationID, AutomationFindingID, AutomationRunID } from "./schema"
import type { ScheduleConfig, AutomationKind, ExecutionMode, PermissionProfile, RunStatus } from "./automation"

export const AutomationTable = sqliteTable(
  "automation",
  {
    id: text().$type<AutomationID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    title: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull(),
    kind: text().$type<AutomationKind>().notNull(),
    thread_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    prompt: text().notNull(),
    schedule: text({ mode: "json" }).$type<ScheduleConfig>().notNull(),
    execution_mode: text().$type<ExecutionMode>().notNull(),
    model: text().notNull(),
    reasoning_effort: text().$type<"none" | "low" | "medium" | "high">(),
    permission_profile: text().$type<PermissionProfile>().notNull(),
    notification_behavior: text().$type<"inbox" | "auto_archive_no_findings">().notNull(),
    max_runtime_minutes: integer(),
    starts_at: integer(),
    ends_at: integer(),
    last_run_at: integer(),
    next_run_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_project_idx").on(table.project_id),
    index("automation_directory_idx").on(table.directory),
    index("automation_due_idx").on(table.enabled, table.next_run_at),
  ],
)

export const AutomationRunTable = sqliteTable(
  "automation_run",
  {
    id: text().$type<AutomationRunID>().primaryKey(),
    automation_id: text()
      .$type<AutomationID>()
      .notNull()
      .references(() => AutomationTable.id, { onDelete: "cascade" }),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    status: text().$type<RunStatus>().notNull(),
    prompt_snapshot: text().notNull(),
    model_snapshot: text().notNull(),
    execution_mode_snapshot: text().$type<ExecutionMode>().notNull(),
    schedule_snapshot: text({ mode: "json" }).$type<ScheduleConfig>().notNull(),
    worktree_path: text(),
    branch_name: text(),
    summary: text(),
    result: text().$type<"findings" | "no_findings" | "needs_approval" | "failed">(),
    findings_count: integer().notNull(),
    diff_additions: integer(),
    diff_deletions: integer(),
    diff_files: integer(),
    error: text(),
    time_queued: integer().notNull(),
    time_started: integer(),
    time_completed: integer(),
    time_read: integer(),
    time_archived: integer(),
    ...Timestamps,
  },
  (table) => [
    index("automation_run_automation_idx").on(table.automation_id),
    index("automation_run_project_status_idx").on(table.project_id, table.status),
    index("automation_run_project_time_idx").on(table.project_id, table.time_created),
    index("automation_run_directory_time_idx").on(table.directory, table.time_created),
  ],
)

export const AutomationFindingTable = sqliteTable(
  "automation_finding",
  {
    id: text().$type<AutomationFindingID>().primaryKey(),
    run_id: text()
      .$type<AutomationRunID>()
      .notNull()
      .references(() => AutomationRunTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    severity: text().$type<"low" | "medium" | "high">().notNull(),
    details: text().notNull(),
    files_changed: text({ mode: "json" }).$type<string[]>().notNull(),
    recommended_next_action: text(),
    ...Timestamps,
  },
  (table) => [index("automation_finding_run_idx").on(table.run_id)],
)
