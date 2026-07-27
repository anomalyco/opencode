import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260606172815_workflow_run_paused_resume",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`resume_of\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
