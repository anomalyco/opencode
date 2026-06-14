import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260501142318_next_venus",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`agent\` text;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`model\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
