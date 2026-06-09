import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260619105033_add_session_time_updated_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`session_time_updated_idx\` ON \`session\` (\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
