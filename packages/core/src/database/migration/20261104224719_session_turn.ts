import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261104224719_session_turn",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_turn_input\` (
          \`id\` text PRIMARY KEY,
          \`type\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`turn_id\` text,
          CONSTRAINT \`fk_session_turn_input_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_turn_input_turn_id_session_turn_id_fk\` FOREIGN KEY (\`turn_id\`) REFERENCES \`session_turn\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_turn\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_turn_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_turn_input_session_idx\` ON \`session_turn_input\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_turn_running_idx\` ON \`session_turn\` (\`session_id\`) WHERE "session_turn"."status" = 'running';`,
      )
    })
  },
}

export default migration
