import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260817120030_tiny_johnny_blaze",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`permission_validator\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
