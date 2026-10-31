import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261030221104_demonic_payback",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`trading_risk\` (
          \`id\` text PRIMARY KEY,
          \`loss_day_limit\` real NOT NULL,
          \`triggered_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`trading_trade\` (
          \`system\` text NOT NULL,
          \`ts\` integer NOT NULL,
          \`pnl\` real,
          \`message\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`trading_trade_pk\` PRIMARY KEY(\`system\`, \`ts\`)
        );
      `)
    })
  },
}

export default migration
