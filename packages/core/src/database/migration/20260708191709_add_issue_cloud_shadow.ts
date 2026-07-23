import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260708191709_add_issue_cloud_shadow",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`SELECT 1`)
    })
  },
} satisfies DatabaseMigration.Migration
