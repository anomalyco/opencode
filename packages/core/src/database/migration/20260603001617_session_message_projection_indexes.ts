import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260603001617_session_message_projection_indexes",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_type_idx\`;`)
      yield* tx.run(`CREATE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`time_created\`,\`id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
