import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803000000_harness_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`harness_task\` (
          \`task_id\` text PRIMARY KEY NOT NULL,
          \`task_prompt\` text,
          \`task_type\` text,
          \`task_model\` text,
          \`task_sub_type\` text,
          \`task_status\` text,
          \`task_sub_status\` text,
          \`task_error\` text,
          \`task_embeddings\` blob,
          \`session_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`harness_subtask_feedback\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`task_id\` text NOT NULL,
          \`subtask_content\` text NOT NULL,
          \`subtask_prompt\` text,
          \`subtask_output\` text,
          \`is_reiterated\` integer DEFAULT 0,
          \`is_prompt_changed\` integer DEFAULT 0,
          \`prompt_iteration_count\` integer DEFAULT 1,
          \`quality_score\` integer,
          \`is_satisfied\` integer,
          \`user_feedback\` text,
          \`changes_requested\` text,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_harness_subtask_feedback_task_id\` FOREIGN KEY (\`task_id\`) REFERENCES \`harness_task\`(\`task_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`harness_version\` (
          \`version_id\` text PRIMARY KEY NOT NULL,
          \`domain_category\` text NOT NULL,
          \`version_number\` integer DEFAULT 1 NOT NULL,
          \`system_prompt\` text NOT NULL,
          \`extracted_rules\` text,
          \`temperature\` real,
          \`max_output_tokens\` integer,
          \`model_options\` text,
          \`tool_overrides\` text,
          \`status\` text DEFAULT 'candidate' NOT NULL,
          \`is_active\` integer DEFAULT 0,
          \`eval_score\` integer,
          \`parent_version_id\` text,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`harness_regression_result\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`version_id\` text NOT NULL,
          \`task_id\` text NOT NULL,
          \`passed\` integer NOT NULL,
          \`score\` integer,
          \`reasoning\` text,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_harness_regression_result_version_id\` FOREIGN KEY (\`version_id\`) REFERENCES \`harness_version\`(\`version_id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_harness_regression_result_task_id\` FOREIGN KEY (\`task_id\`) REFERENCES \`harness_task\`(\`task_id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
