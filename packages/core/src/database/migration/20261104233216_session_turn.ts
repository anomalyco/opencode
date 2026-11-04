import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261104233216_session_turn",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_turn\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`data\` text,
          CONSTRAINT \`fk_session_turn_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_turn_session_status_idx\` ON \`session_turn\` (\`session_id\`,\`status\`);`)
    })
  },
}

export default migration
