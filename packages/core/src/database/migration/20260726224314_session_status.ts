import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260726224314_session_status",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_status\` (
          \`session_id\` text PRIMARY KEY,
          \`status\` text NOT NULL,
          \`detail\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_status_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
