import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

const migration: DatabaseMigration.Migration = {
  id: "20260808014022_remove_legacy_accounts",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`account_state\`;`)
      yield* tx.run(`DROP TABLE \`account\`;`)
      yield* tx.run(`DROP TABLE \`control_account\`;`)
    })
  },
}

export default migration
