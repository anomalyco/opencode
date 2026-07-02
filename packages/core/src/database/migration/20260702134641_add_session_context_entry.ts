import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260702134641_add_session_context_entry",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_context_entry\` (
          \`session_id\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`session_context_entry_pk\` PRIMARY KEY(\`session_id\`, \`key\`),
          CONSTRAINT \`fk_session_context_entry_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
