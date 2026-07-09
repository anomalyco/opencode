import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709140111_resume_after_restart",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`resume_after_restart\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(
        `CREATE INDEX \`session_resume_after_restart_idx\` ON \`session\` (\`resume_after_restart\`) WHERE "session"."resume_after_restart" = 1;`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
