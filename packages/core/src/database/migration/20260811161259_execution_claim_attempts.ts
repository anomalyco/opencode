import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260811161259_execution_claim_attempts",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`resume_attempts\` integer DEFAULT 0 NOT NULL;`)
    })
  },
}

export default migration
