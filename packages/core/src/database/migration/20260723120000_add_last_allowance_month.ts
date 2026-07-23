import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260723120000_add_last_allowance_month",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        ALTER TABLE \`token_balance\` ADD COLUMN \`lastAllowanceMonth\` text DEFAULT '' NOT NULL;
      `)
    })
  },
} satisfies DatabaseMigration.Migration
