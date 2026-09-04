import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260904183422_worktree_configuration",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`worktree\` ADD \`configuration_directory\` text;`)
    })
  },
}

export default migration
