import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260606101213_add_workflow_run_directory",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`directory\` text DEFAULT '' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
