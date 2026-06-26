import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260622142730_simplify_session_context_epoch",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_context_epoch\` DROP COLUMN \`agent\`;`)
      yield* tx.run(`ALTER TABLE \`session_context_epoch\` DROP COLUMN \`replacement_seq\`;`)
      yield* tx.run(`ALTER TABLE \`session_context_epoch\` DROP COLUMN \`revision\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
