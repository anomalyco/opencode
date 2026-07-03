import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260703181610_event_created_column",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`event\` ADD \`created\` integer NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
