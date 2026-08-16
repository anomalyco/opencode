import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260413175956_chief_energizer",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_entry\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_entry_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_entry_session_idx\` ON \`session_entry\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_entry_session_type_idx\` ON \`session_entry\` (\`session_id\`,\`type\`);`)
      yield* tx.run(`CREATE INDEX \`session_entry_time_created_idx\` ON \`session_entry\` (\`time_created\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
