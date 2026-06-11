import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260603040000_session_message_projection_order",
  up(tx) {
    return Effect.gen(function* () {
      // Pre-launch Session projections were written before durable event persistence
      // became unconditional, so they cannot be assigned truthful aggregate order.
      yield* tx.run(`DELETE FROM \`session_message\`;`)
      yield* tx.run(`ALTER TABLE \`session_message\` ADD COLUMN \`seq\` integer NOT NULL;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_type_time_created_id_idx\`;`)
      yield* tx.run(`CREATE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
