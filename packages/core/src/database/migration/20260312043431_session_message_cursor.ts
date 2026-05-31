import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260312043431_session_message_cursor",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`message_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`part_message_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
