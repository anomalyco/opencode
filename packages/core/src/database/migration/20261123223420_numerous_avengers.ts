import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261123223420_numerous_avengers",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_v2_root_project_path_updated_idx\` ON \`session_v2\` (\`project_id\`,\`path\`,"time_updated" desc,"id" desc) WHERE "session_v2"."parent_id" is null and "session_v2"."time_archived" is null;`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_v2_root_updated_idx\` ON \`session_v2\` (\`parent_id\`,"time_updated" desc,"id" desc) WHERE "session_v2"."time_archived" is null;`,
      )
    })
  },
}

export default migration
