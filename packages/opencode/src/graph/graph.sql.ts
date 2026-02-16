// packages/opencode/src/graph/graph.sql.ts
// Database schema for task graph
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"

export const TaskNodeTable = sqliteTable(
  "task_node",
  {
    id: text().notNull().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    type: text().notNull(),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    duration: integer(),
    tokens_used: integer(),
    result: text(),
    data: text({ mode: "json" }),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  (table) => [
    index("task_node_session_idx").on(table.session_id),
    index("task_node_status_idx").on(table.status),
    index("task_node_type_idx").on(table.type),
  ],
)

export const TaskDependencyTable = sqliteTable(
  "task_dependency",
  {
    source_id: text()
      .notNull()
      .references(() => TaskNodeTable.id, { onDelete: "cascade" }),
    target_id: text()
      .notNull()
      .references(() => TaskNodeTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("task_dependency_source_idx").on(table.source_id),
    index("task_dependency_target_idx").on(table.target_id),
  ],
)

export const TaskMetricsTable = sqliteTable(
  "task_metrics",
  {
    id: text().notNull().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    task_id: text()
      .notNull()
      .references(() => TaskNodeTable.id, { onDelete: "cascade" }),
    duration: integer().notNull(),
    tokens_used: integer().notNull(),
    attempts: integer().notNull(),
    success: integer().notNull(),
    complexity: text().notNull(),
    skills_used: text({ mode: "json" }),
    type: text().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("task_metrics_session_idx").on(table.session_id),
    index("task_metrics_task_idx").on(table.task_id),
    index("task_metrics_type_idx").on(table.type),
  ],
)

export const StateSnapshotTable = sqliteTable(
  "state_snapshot",
  {
    id: text().notNull().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    graph_id: text().notNull(),
    timestamp: integer().notNull(),
    completed_nodes: text({ mode: "json" }),
    in_progress_nodes: text({ mode: "json" }),
    failed_nodes: text({ mode: "json" }),
    metadata: text({ mode: "json" }),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("state_snapshot_session_idx").on(table.session_id),
    index("state_snapshot_graph_idx").on(table.graph_id),
    index("state_snapshot_timestamp_idx").on(table.timestamp),
  ],
)

export const DeadLetterTable = sqliteTable(
  "dead_letter",
  {
    id: text().notNull().primaryKey(),
    task_id: text().notNull(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    error: text().notNull(),
    attempt_count: integer().notNull(),
    last_attempt: integer().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("dead_letter_session_idx").on(table.session_id),
    index("dead_letter_task_idx").on(table.task_id),
  ],
)