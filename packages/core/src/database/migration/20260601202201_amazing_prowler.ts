import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

const migration: DatabaseMigration.Migration = {
  id: "20260601202201_amazing_prowler",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`permission\`;`)
    })
  },
}

export default migration
