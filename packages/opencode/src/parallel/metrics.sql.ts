import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { PlanTable } from "./plan.sql"
import { Timestamps } from "../storage/schema.sql"
import type { PlanID } from "./schema"

export const ParallelMetricsTable = sqliteTable(
  "parallel_metrics",
  {
    plan_id: text().$type<PlanID>().primaryKey().references(() => PlanTable.id, { onDelete: "cascade" }),
    spawn_attempts: integer().notNull().default(0),
    spawn_success: integer().notNull().default(0),
    spawn_failure: integer().notNull().default(0),
    timeout_count: integer().notNull().default(0),
    plan_outcome: text().$type<"done" | "partial_success" | "failed">(),
    total_input_tokens: integer().notNull().default(0),
    total_output_tokens: integer().notNull().default(0),
    orchestrator_calls: integer().notNull().default(0),
    worker_count: integer().notNull().default(0),
    merge_calls: integer().notNull().default(0),
    total_duration_ms: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("parallel_metrics_outcome_idx").on(table.plan_outcome),
  ],
)
