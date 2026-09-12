import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260820042300_add_session_ephemeral",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`ephemeral\` integer DEFAULT false NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
