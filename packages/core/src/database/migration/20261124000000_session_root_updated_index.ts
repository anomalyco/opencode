import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"
const migration: DatabaseMigration.Migration = {
  id: "20261124000000_session_root_updated_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_v2_root_updated_idx\` ON \`session_v2\` (\`parent_id\`,"time_updated" desc,"id" desc) WHERE "session_v2"."time_archived" is null;`,
      )
    })
  },
}
export default migration
