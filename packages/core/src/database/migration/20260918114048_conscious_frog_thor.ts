import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260918114048_conscious_frog_thor",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`event_seq_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`event_message_id_idx\`;`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`event_message_id_idx\` ON \`event\` (\`aggregate_id\`,json_extract("data", '$.messageID'));`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
