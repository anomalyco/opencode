import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823133938_session_time_created_idx",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`session_time_created_idx\` ON \`session\` (\`time_created\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
