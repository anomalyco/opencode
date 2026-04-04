import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { MessageV2 } from "./message-v2"
import type { Snapshot } from "../snapshot"
import type { Permission } from "../permission"
import type { ProjectID } from "../project/schema"
import type { SessionID, MessageID, PartID } from "./schema"
import type { WorkspaceID } from "../control-plane/schema"
import { Timestamps } from "../storage/schema.sql"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceID>(),
    parent_id: text().$type<SessionID>(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: MessageID; partID?: PartID; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<Permission.Ruleset>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<Permission.Ruleset>(),
})

export const MemoryFactTable = sqliteTable(
  "memory_fact",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>(),
    category: text().notNull(),
    subject: text().notNull(),
    value: text().notNull(),
    confidence: integer().notNull().default(0),
    source_hash: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("memory_fact_project_idx").on(table.project_id),
    index("memory_fact_subject_idx").on(table.project_id, table.subject),
  ],
)

export const MemoryWindowTable = sqliteTable(
  "memory_window",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().notNull(),
    started_at: integer().notNull(),
    ended_at: integer().notNull(),
    goal: text().notNull(),
    instructions: text(),
    discoveries: text(),
    accomplished: text(),
    in_progress: text(),
    blocked_on: text(),
    files_touched: text({ mode: "json" }).$type<string[]>().notNull(),
    relevant_dirs: text({ mode: "json" }).$type<string[]>().notNull(),
    message_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    parent_window_id: text(),
    ...Timestamps,
  },
  (table) => [
    index("memory_window_session_idx").on(table.session_id),
    index("memory_window_project_time_idx").on(table.project_id, table.ended_at),
  ],
)

export const MemoryArtifactTable = sqliteTable(
  "memory_artifact",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    window_id: text()
      .notNull()
      .references(() => MemoryWindowTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    content: text().notNull(),
    file_path: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("memory_artifact_window_idx").on(table.window_id),
    index("memory_artifact_kind_idx").on(table.project_id, table.kind),
  ],
)

export const MemoryProjectTable = sqliteTable(
  "memory_project",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    project_key: text().notNull(),
    project_name: text().notNull(),
    status: text().notNull().default("planned"),
    summary: text().notNull(),
    latest_progress: text(),
    blockers: text(),
    source_window_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    ...Timestamps,
  },
  (table) => [index("memory_project_key_idx").on(table.project_id, table.project_key)],
)
