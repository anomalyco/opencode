import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260611192811_lush_chimera",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`credential\` ADD \`integration_id\` text NOT NULL;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`credential_connector_active_idx\`;`)
      yield* tx.run(`ALTER TABLE \`credential\` DROP COLUMN \`connector_id\`;`)
      yield* tx.run(`ALTER TABLE \`credential\` DROP COLUMN \`method_id\`;`)
      yield* tx.run(`ALTER TABLE \`credential\` DROP COLUMN \`active\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
