import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260705061319_silly_the_hood",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`context_mode\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
