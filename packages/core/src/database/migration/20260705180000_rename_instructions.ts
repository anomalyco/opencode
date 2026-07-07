import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260705180000_rename_instructions",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_context_entry\` RENAME TO \`instruction_entry\``)
      yield* tx.run(`ALTER TABLE \`session_context_epoch\` RENAME TO \`instruction_checkpoint\``)
      yield* tx.run(`
        UPDATE \`event\`
        SET \`type\` = 'session.instructions.updated.1'
        WHERE \`type\` = 'session.context.updated.1'
      `)
    })
  },
} satisfies DatabaseMigration.Migration
