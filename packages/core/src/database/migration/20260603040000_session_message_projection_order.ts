import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260603040000_session_message_projection_order",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_message\` ADD COLUMN \`seq\` integer NOT NULL DEFAULT 0;`)
      yield* tx.run(
        `UPDATE \`session_message\` SET \`seq\` = COALESCE((SELECT \`seq\` + 1 FROM \`event\` WHERE \`event\`.\`id\` = \`session_message\`.\`id\`), 0);`,
      )
      const unmatched = yield* tx.get<{ count: number }>(
        `SELECT COUNT(*) AS \`count\` FROM \`session_message\` WHERE \`seq\` = 0;`,
      )
      if ((unmatched?.count ?? 0) > 0)
        return yield* Effect.die("Cannot migrate session_message projections without matching durable events")
      yield* tx.run(`UPDATE \`session_message\` SET \`seq\` = \`seq\` - 1;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_type_time_created_id_idx\`;`)
      yield* tx.run(`CREATE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
