import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260710205322_remove_status_type",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`SELECT 1`)
    })
  },
} satisfies DatabaseMigration.Migration
