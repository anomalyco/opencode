import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260708183506_add_issue_linear_updated_at",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`SELECT 1`)
    })
  },
} satisfies DatabaseMigration.Migration
