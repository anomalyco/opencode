import { customType, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const vecCol = customType<{
  data: Float32Array
  driverData: Buffer
}>({
  dataType() {
    return "blob"
  },
  toDriver(val: Float32Array): Buffer {
    return Buffer.from(val.buffer, val.byteOffset, val.byteLength)
  },
  fromDriver(val: Buffer): Float32Array {
    const arBuf = val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength)
    return new Float32Array(arBuf)
  },
})

export const harness_task = sqliteTable("harness_task", {
  task_id: text().primaryKey(),
  task_prompt: text(),
  task_type: text(),
  task_model: text(),
  task_sub_type: text(),
  task_status: text(),
  task_sub_status: text(),
  task_error: text(),
  task_embeddings: vecCol(),
})

export const harness_subtask_feedback = sqliteTable("harness_subtask_feedback", {
  id: text().primaryKey(),
  task_id: text().notNull().references(() => harness_task.task_id, { onDelete: "cascade" }),
  subtask_content: text().notNull(),
  subtask_prompt: text(),
  subtask_output: text(),
  is_reiterated: integer({ mode: "boolean" }).default(false),
  is_prompt_changed: integer({ mode: "boolean" }).default(false),
  prompt_iteration_count: integer().default(1),
  quality_score: integer(),
  is_satisfied: integer({ mode: "boolean" }),
  user_feedback: text(),
  changes_requested: text(),
  created_at: integer().notNull().$default(() => Date.now()),
})

export const harness_version = sqliteTable("harness_version", {
  version_id: text().primaryKey(),
  domain_category: text().notNull(),
  version_number: integer().notNull().default(1),
  system_prompt: text().notNull(),
  extracted_rules: text({ mode: "json" }),
  temperature: real(),
  max_output_tokens: integer(),
  model_options: text(),
  tool_overrides: text(),
  status: text().$type<"candidate" | "testing" | "active" | "rejected" | "archived">().notNull().default("candidate"),
  is_active: integer({ mode: "boolean" }).default(false),
  eval_score: integer(),
  parent_version_id: text(),
  created_at: integer().notNull().$default(() => Date.now()),
})

export const harness_regression_result = sqliteTable("harness_regression_result", {
  id: text().primaryKey(),
  version_id: text().notNull().references(() => harness_version.version_id, { onDelete: "cascade" }),
  passed: integer({ mode: "boolean" }).notNull(),
  score_delta: real(),
  test_summary: text({ mode: "json" }),
  created_at: integer().notNull().$default(() => Date.now()),
})
