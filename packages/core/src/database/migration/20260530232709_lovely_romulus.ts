import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260530232709_lovely_romulus",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`metadata\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
