import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260613180000_session_goals",
  up(tx) {
    return Effect.gen(function* () {
      // Create goal table for native per-session persisted goals (issue #27167).
      yield* tx.run(`
        CREATE TABLE \`goal\` (
          \`session_id\` text PRIMARY KEY,
          \`text\` text NOT NULL,
          \`status\` text NOT NULL,
          \`budget_tokens\` integer,
          \`tokens_used\` integer NOT NULL DEFAULT 0,
          \`time_ms\` integer NOT NULL DEFAULT 0,
          \`started_at\` integer NOT NULL,
          \`paused_at\` integer,
          \`completed_at\` integer,
          \`verification\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_goal_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`goal_session_idx\` ON \`goal\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
