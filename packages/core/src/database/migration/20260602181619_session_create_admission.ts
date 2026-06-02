import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260602181619_session_create_admission",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_create_admission\` (
          \`idempotency_key\` text PRIMARY KEY,
          \`contract\` text NOT NULL,
          \`session\` text NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
