import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260817140444_open_jackpot",
  up(tx) {
    return Effect.gen(function* () {
      if (
        (yield* tx.all<{ name: string }>(`PRAGMA table_info(\`permission_decisions\`)`)).some(
          (column) => column.name === "prompt",
        )
      ) {
        yield* tx.run(`ALTER TABLE \`permission_decisions\` DROP COLUMN \`prompt\`;`)
      }
    })
  },
} satisfies DatabaseMigration.Migration
