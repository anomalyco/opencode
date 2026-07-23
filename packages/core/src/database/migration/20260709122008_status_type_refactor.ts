import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709122008_status_type_refactor",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`SELECT 1`)
    })
  },
} satisfies DatabaseMigration.Migration
