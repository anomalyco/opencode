import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803161726_amused_frightful_four",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`permission_decisions\` ADD \`prompt\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
