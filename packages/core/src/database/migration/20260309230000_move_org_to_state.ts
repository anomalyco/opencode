import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260309230000_move_org_to_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`account_state\` ADD \`active_org_id\` text;`)
      yield* tx.run(
        `UPDATE \`account_state\` SET \`active_org_id\` = (SELECT \`selected_org_id\` FROM \`account\` WHERE \`account\`.\`id\` = \`account_state\`.\`active_account_id\`);`,
      )
      yield* tx.run(`ALTER TABLE \`account\` DROP COLUMN \`selected_org_id\`;`)
    })
  },
}

export default migration
