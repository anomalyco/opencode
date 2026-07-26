import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260705045947_productive_masque",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`result\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
