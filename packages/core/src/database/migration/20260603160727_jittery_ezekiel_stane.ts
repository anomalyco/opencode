import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260603160727_jittery_ezekiel_stane",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_input_session_pending_seq_idx\`;`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`event_aggregate_type_seq_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_input_session_pending_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`delivery\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
