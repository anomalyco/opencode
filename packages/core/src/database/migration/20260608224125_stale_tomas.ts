import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260608224125_stale_tomas",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`session_directory_time_idx\` ON \`session\` (\`directory\`,\`time_created\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_time_idx\` ON \`session\` (\`workspace_id\`,\`time_created\`,\`id\`);`)
      yield* tx.run(`CREATE INDEX \`session_project_time_idx\` ON \`session\` (\`project_id\`,\`time_created\`,\`id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
