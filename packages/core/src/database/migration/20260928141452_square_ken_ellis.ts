import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260928141452_square_ken_ellis",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`session_time_created_id_idx\` ON \`session\` (\`time_created\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
