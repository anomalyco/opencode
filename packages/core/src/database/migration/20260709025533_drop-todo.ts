import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709025533_drop-todo",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`todo_session_idx\`;`)
      yield* tx.run(`DROP TABLE \`todo\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
