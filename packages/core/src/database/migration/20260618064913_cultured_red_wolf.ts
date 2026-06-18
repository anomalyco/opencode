import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260618064913_cultured_red_wolf",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`goal\` (
          \`session_id\` text PRIMARY KEY,
          \`text\` text NOT NULL,
          \`status\` text NOT NULL,
          \`budget_tokens\` integer,
          \`tokens_used\` integer DEFAULT 0 NOT NULL,
          \`time_ms\` integer DEFAULT 0 NOT NULL,
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
