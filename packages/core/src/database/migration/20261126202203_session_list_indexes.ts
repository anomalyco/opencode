import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261126202203_session_list_indexes",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`session_v2_project_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_v2_workspace_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_v2_parent_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_project_updated_idx\` ON \`session_v2\` (\`project_id\`,\`time_updated\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_v2_workspace_updated_idx\` ON \`session_v2\` (\`workspace_id\`,\`time_updated\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_v2_parent_updated_idx\` ON \`session_v2\` (\`parent_id\`,\`time_updated\`,\`id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_v2_directory_updated_idx\` ON \`session_v2\` (\`directory\`,\`time_updated\`,\`id\`);`,
      )
    })
  },
}

export default migration
