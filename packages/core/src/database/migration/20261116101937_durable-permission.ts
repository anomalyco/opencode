import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261116101937_durable-permission",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_permission\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          \`call_id\` text NOT NULL,
          \`question_id\` text NOT NULL,
          \`prepared\` text NOT NULL,
          \`request\` text NOT NULL,
          \`agent\` text,
          \`status\` text DEFAULT 'pending' NOT NULL,
          \`message\` text,
          CONSTRAINT \`fk_session_permission_session_id_assistant_message_id_generation_session_message_session_id_id_step_started_seq_fk\` FOREIGN KEY (\`session_id\`,\`assistant_message_id\`,\`generation\`) REFERENCES \`session_message\`(\`session_id\`,\`id\`,\`step_started_seq\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_permission_step_call_unique\` ON \`session_permission\` (\`session_id\`,\`assistant_message_id\`,\`generation\`,\`call_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_permission_question_unique\` ON \`session_permission\` (\`question_id\`);`,
      )
    })
  },
}

export default migration
