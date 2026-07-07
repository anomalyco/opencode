import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260707075505_add-session-tool-permissions",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`tool_permissions\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
