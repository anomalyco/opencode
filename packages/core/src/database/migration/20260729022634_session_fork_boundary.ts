import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729022634_session_fork_boundary",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`fork_boundary\` text;`)
      yield* tx.run(`ALTER TABLE \`session\` DROP COLUMN \`fork_message_id\`;`)
      yield* tx.run(`ALTER TABLE \`session\` DROP COLUMN \`fork_seq\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
