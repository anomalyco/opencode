import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260708004136_session-execution-recovery",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_execution_recovery\` (
          \`session_id\` text PRIMARY KEY,
          \`interrupted_seq\` integer NOT NULL,
          CONSTRAINT \`fk_session_execution_recovery_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
