import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260730195856_optional_session_title",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` RENAME COLUMN \`title\` TO \`title_old\``)
      yield* tx.run(`ALTER TABLE \`session\` ADD COLUMN \`title\` text`)
      yield* tx.run(`UPDATE \`session\` SET \`title\` = \`title_old\``)
      yield* tx.run(`ALTER TABLE \`session\` DROP COLUMN \`title_old\``)
    })
  },
} satisfies DatabaseMigration.Migration
