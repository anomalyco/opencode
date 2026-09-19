import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260919071402_question_pending",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`question_pending\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`request\` text NOT NULL,
          \`asked_seq\` integer NOT NULL,
          CONSTRAINT \`fk_question_pending_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`question_pending_session_seq_idx\` ON \`question_pending\` (\`session_id\`,\`asked_seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
