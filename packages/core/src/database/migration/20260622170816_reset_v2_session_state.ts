import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260622170816_reset_v2_session_state",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE TEMP TABLE \`__reset_v2_session_state\` AS SELECT DISTINCT \`aggregate_id\` AS \`id\` FROM \`event\` WHERE \`type\` = 'session.next.compaction.ended.1';`,
      )
      yield* tx.run(
        `DELETE FROM \`session_context_epoch\` WHERE \`session_id\` IN (SELECT \`id\` FROM \`__reset_v2_session_state\`);`,
      )
      yield* tx.run(
        `DELETE FROM \`session_input\` WHERE \`session_id\` IN (SELECT \`id\` FROM \`__reset_v2_session_state\`);`,
      )
      yield* tx.run(
        `DELETE FROM \`session_message\` WHERE \`session_id\` IN (SELECT \`id\` FROM \`__reset_v2_session_state\`);`,
      )
      yield* tx.run(
        `DELETE FROM \`event\` WHERE \`aggregate_id\` IN (SELECT \`id\` FROM \`__reset_v2_session_state\`);`,
      )
      yield* tx.run(
        `DELETE FROM \`event_sequence\` WHERE \`aggregate_id\` IN (SELECT \`id\` FROM \`__reset_v2_session_state\`);`,
      )
      yield* tx.run(
        `UPDATE \`session\` SET \`workspace_id\` = NULL WHERE \`id\` IN (SELECT \`id\` FROM \`__reset_v2_session_state\`);`,
      )
      yield* tx.run(`DROP TABLE \`__reset_v2_session_state\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
