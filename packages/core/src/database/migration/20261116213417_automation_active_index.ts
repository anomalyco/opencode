import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261116213417_automation_active_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`automation_due_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`automation_active_idx\` ON \`automation\` (\`next_due_at\`) WHERE "automation"."status" = 'active';`,
      )
    })
  },
}

export default migration
