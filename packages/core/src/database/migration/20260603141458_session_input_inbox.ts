import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260603141458_session_input_inbox",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_input\` (
          \`seq\` integer PRIMARY KEY AUTOINCREMENT,
          \`id\` text NOT NULL UNIQUE,
          \`session_id\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
