import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260825110242_session_time_updated_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_v2_parent_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_parent_time_updated_id_idx\` ON \`session_v2\` (\`parent_id\`,\`time_updated\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_v2_time_updated_id_idx\` ON \`session_v2\` (\`time_updated\`,\`id\`);`)
    })
  },
}

export default migration
