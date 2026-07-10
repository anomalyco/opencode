import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"

export const EventLogTable = sqliteTable(
  "event_log",
  {
    event_id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    parent_event_id: text(),
    event_type: text().notNull(),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text().$type<"pending" | "running" | "success" | "failed" | "skipped">(),
    token_cost: integer().default(0),
    duration_ms: integer().default(0),
    sequence_index: integer().notNull(),
    timestamp: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    uniqueIndex("idx_event_session_seq").on(table.session_id, table.sequence_index),
    index("idx_event_parent").on(table.parent_event_id),
    index("idx_event_type").on(table.session_id, table.event_type, table.timestamp),
  ],
)

export const CheckpointTable = sqliteTable(
  "checkpoint",
  {
    checkpoint_id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    last_event_id: text(),
    level: text().$type<"L1" | "L2" | "L3">().notNull(),
    execution_state: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    context_hash: text().notNull(),
    git_head_hash: text(),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("idx_cp_session").on(table.session_id, table.level, table.created_at)],
)

export const CapabilityGraphTable = sqliteTable(
  "capability_graph",
  {
    capability_id: text().primaryKey(),
    name: text().notNull(),
    description: text(),
    input_schema: text({ mode: "json" }).$type<Record<string, unknown>>(),
    output_schema: text({ mode: "json" }).$type<Record<string, unknown>>(),
    tags: text({ mode: "json" }).$type<string[]>(),
    risk_level: integer().$type<0 | 1 | 2 | 3>().default(0),
    total_calls: integer().default(0),
    success_rate: real().default(0),
    avg_duration_ms: integer().default(0),
    avg_token_cost: integer().default(0),
    last_used_at: integer(),
  },
  (table) => [index("idx_cap_evolution").on(table.total_calls, table.success_rate)],
)

export const SessionMemoriesTable = sqliteTable(
  "session_memory",
  {
    memory_id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    token_count: integer().notNull(),
    importance: real().default(0.5),
    access_count: integer().default(0),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    last_accessed: integer(),
    retention_score: real().default(1.0),
  },
  (table) => [index("idx_mem_retention").on(table.session_id, table.retention_score)],
)

export const AgentSelfTable = sqliteTable("agent_self", {
  rule_id: text().primaryKey(),
  category: text().$type<"capability_boundary" | "optimal_strategy" | "self_reflection">().notNull(),
  content: text().notNull(),
  token_count: integer().notNull(),
  importance: real().default(0.8),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const UserProfileTable = sqliteTable("user_profile", {
  profile_id: text().primaryKey(),
  user_hash: text().notNull(),
  category: text().$type<"coding_style" | "tech_stack" | "preference">().notNull(),
  content: text().notNull(),
  token_count: integer().notNull(),
  importance: real().default(0.7),
  frequency_score: real().default(0.0),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
  last_accessed: integer(),
})

export const RepairMemoriesTable = sqliteTable(
  "repair_memory",
  {
    repair_id: text().primaryKey(),
    error_category: text().notNull(),
    exact_hash: text().notNull(),
    fuzzy_hash: text().notNull(),
    error_type: text().notNull(),
    core_symbols: text({ mode: "json" }).$type<string[]>(),
    condition: text().notNull(),
    recovery_action: text().notNull(),
    success_rate: real().default(0.0),
    hit_count: integer().default(0),
    occurrence_count: integer().default(1),
    specificity: integer().default(0),
    created_at: integer()
      .notNull()
      .$default(() => Date.now()),
    last_hit: integer(),
    retention_score: real().default(1.0),
  },
  (table) => [
    index("idx_repair_exact").on(table.exact_hash),
    index("idx_repair_fuzzy").on(table.fuzzy_hash),
    index("idx_repair_category").on(table.error_category, table.success_rate),
    index("idx_repair_fuzzy_lkp").on(table.fuzzy_hash, table.success_rate),
  ],
)

export const SkillsTable = sqliteTable("skill", {
  skill_id: text().primaryKey(),
  trigger_condition: text().notNull(),
  prompt_template: text().notNull(),
  priority: integer().default(0),
  scope: text().$type<"global" | "session" | "task">().default("session"),
  hit_count: integer().default(0),
  created_at: integer()
    .notNull()
    .$default(() => Date.now()),
})

export * as EngineSQL from "./sql"
