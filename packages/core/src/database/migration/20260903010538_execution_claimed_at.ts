import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260903010538_execution_claimed_at",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` RENAME COLUMN \`time_suspended\` TO \`execution_claimed_at\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_v2_time_suspended_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_execution_claimed_at_idx\` ON \`session_v2\` (\`execution_claimed_at\`) WHERE "session_v2"."execution_claimed_at" is not null;`,
      )
    })
  },
}

export default migration
