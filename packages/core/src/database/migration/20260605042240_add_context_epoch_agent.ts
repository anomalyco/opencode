import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260605042240_add_context_epoch_agent",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_context_epoch\` ADD \`agent\` text DEFAULT 'build' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
