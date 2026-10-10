import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261009040000_session_directory_lookup_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_v2_directory_updated_idx\` ON \`session_v2\` (rtrim(directory, '/'),\`time_updated\`,\`id\`) WHERE directory <> '';`,
      )
    })
  },
}

export default migration
