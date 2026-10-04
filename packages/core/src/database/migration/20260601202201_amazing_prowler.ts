import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260601202201_amazing_prowler",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP TABLE \`permission\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
