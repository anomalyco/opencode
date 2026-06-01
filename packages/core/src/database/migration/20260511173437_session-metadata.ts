import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260511173437_session-metadata",
  up(tx) {
    return Effect.gen(function* () {
      // This column briefly shipped again under 20260530232709_lovely_romulus.
      if (
        (yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session\`)`)).some((column) => column.name === "metadata")
      )
        return
      yield* tx.run(`ALTER TABLE \`session\` ADD \`metadata\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
