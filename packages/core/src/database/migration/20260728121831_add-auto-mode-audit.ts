import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260728121831_add-auto-mode-audit",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`permission_decisions\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`permission\` text NOT NULL,
          \`patterns\` text NOT NULL,
          \`metadata\` text,
          \`verdict\` text NOT NULL,
          \`reason\` text,
          \`model\` text NOT NULL,
          \`latency_ms\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_permission_decisions_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_auto_summary\` (
          \`session_id\` text PRIMARY KEY,
          \`summary\` text NOT NULL,
          \`model\` text NOT NULL,
          \`turn_count\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`fk_session_auto_summary_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_title_history\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`source\` text NOT NULL,
          \`model\` text,
          \`trigger_message_id\` text,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_session_title_history_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`permission_decisions_session_idx\` ON \`permission_decisions\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_title_history_session_idx\` ON \`session_title_history\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
