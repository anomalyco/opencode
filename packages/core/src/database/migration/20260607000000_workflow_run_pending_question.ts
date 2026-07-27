import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260607000000_workflow_run_pending_question",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`pending_question\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
