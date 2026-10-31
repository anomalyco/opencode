import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261029234643_trading-tasks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`trading_task\` (
          \`id\` text PRIMARY KEY,
          \`kind\` text NOT NULL,
          \`system_ids\` text NOT NULL,
          \`run_at\` integer NOT NULL,
          \`status\` text DEFAULT 'pending' NOT NULL,
          \`resolved_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
}

export default migration
