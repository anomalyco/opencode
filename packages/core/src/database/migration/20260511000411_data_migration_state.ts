import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260511000411_data_migration_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`data_migration\` (
          \`name\` text PRIMARY KEY,
          \`time_completed\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
