import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260911000000_message_diff",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`message_diff\` (
          \`message_id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`diffs\` text NOT NULL,
          CONSTRAINT \`fk_message_diff_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`message_diff_session_idx\` ON \`message_diff\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
