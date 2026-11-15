import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261115180731_step-parking",
  up(tx) {
    return Effect.gen(function* () {
      const pending = yield* tx.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM session_pending_step",
      )
      const questions = yield* tx.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM session_question",
      )
      if ((pending?.count ?? 0) !== 0 || (questions?.count ?? 0) !== 0) {
        return yield* Effect.fail(
          new Error("Step parking migration requires empty pre-parking tables"),
        )
      }
      yield* tx.run(`ALTER TABLE \`session_pending_step\` ADD \`data\` text NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_question\` ADD \`call_id\` text NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_question\` ADD \`prepared\` text NOT NULL;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_question_step_call_unique\` ON \`session_question\` (\`session_id\`,\`assistant_message_id\`,\`generation\`,\`call_id\`);`,
      )
    })
  },
}

export default migration
