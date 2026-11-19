import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261115165607_step-ownership",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_pending_step\` (
          \`session_id\` text PRIMARY KEY NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          CONSTRAINT \`fk_session_pending_step_session_id_assistant_message_id_generation_session_message_session_id_id_step_started_seq_fk\` FOREIGN KEY (\`session_id\`,\`assistant_message_id\`,\`generation\`) REFERENCES \`session_message\`(\`session_id\`,\`id\`,\`step_started_seq\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_question\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`generation\` integer NOT NULL,
          CONSTRAINT \`fk_session_question_session_id_assistant_message_id_generation_session_message_session_id_id_step_started_seq_fk\` FOREIGN KEY (\`session_id\`,\`assistant_message_id\`,\`generation\`) REFERENCES \`session_message\`(\`session_id\`,\`id\`,\`step_started_seq\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_message\` ADD \`step_started_seq\` integer;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_step_owner_unique\` ON \`session_message\` (\`session_id\`,\`id\`,\`step_started_seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_question_step_owner_idx\` ON \`session_question\` (\`session_id\`,\`assistant_message_id\`,\`generation\`);`,
      )
    })
  },
}

export default migration
