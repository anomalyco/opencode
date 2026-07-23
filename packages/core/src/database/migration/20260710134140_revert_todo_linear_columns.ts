import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260710134140_revert_todo_linear_columns",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`SELECT 1`)
    })
  },
} satisfies DatabaseMigration.Migration
