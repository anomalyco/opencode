import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260504145000_add_sync_owner",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`event_sequence\` ADD \`owner_id\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
