import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260825004258_session_inbox_order",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_inbox\` ADD \`order_seq\` integer;`)
      yield* tx.run(
        `CREATE INDEX \`session_inbox_session_delivery_order_idx\` ON \`session_inbox\` (\`session_id\`,\`delivery\`,coalesce("order_seq", "enqueued_seq"));`,
      )
    })
  },
}

export default migration
