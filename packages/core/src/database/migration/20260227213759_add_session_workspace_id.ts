import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260227213759_add_session_workspace_id",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`workspace_id\` text;`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
