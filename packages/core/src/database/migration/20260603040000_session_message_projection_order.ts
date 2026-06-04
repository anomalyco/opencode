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
      yield* tx.run(`
        WITH \`unmatched\` AS (
          SELECT
            \`session_message\`.\`id\`,
            COALESCE(MAX(\`event\`.\`seq\`), -1) + ROW_NUMBER() OVER (
              PARTITION BY \`session_message\`.\`session_id\`
              ORDER BY \`session_message\`.\`time_created\`, \`session_message\`.\`id\`
            ) + 1 AS \`seq\`
          FROM \`session_message\`
          LEFT JOIN \`event\` ON \`event\`.\`aggregate_id\` = \`session_message\`.\`session_id\`
          WHERE NOT EXISTS (SELECT 1 FROM \`event\` AS \`source\` WHERE \`source\`.\`id\` = \`session_message\`.\`id\`)
          GROUP BY \`session_message\`.\`id\`
        )
        UPDATE \`session_message\`
        SET \`seq\` = (SELECT \`unmatched\`.\`seq\` FROM \`unmatched\` WHERE \`unmatched\`.\`id\` = \`session_message\`.\`id\`)
        WHERE \`session_message\`.\`id\` IN (SELECT \`id\` FROM \`unmatched\`);
      `)
      yield* tx.run(`UPDATE \`session_message\` SET \`seq\` = \`seq\` - 1;`)
      yield* tx.run(
        `INSERT INTO \`event_sequence\` (\`aggregate_id\`, \`seq\`)
        SELECT \`session_id\`, MAX(\`seq\`) FROM \`session_message\`
        GROUP BY \`session_id\`
        ON CONFLICT(\`aggregate_id\`) DO UPDATE SET \`seq\` = MAX(\`event_sequence\`.\`seq\`, excluded.\`seq\`);`,
      )
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_session_type_time_created_id_idx\`;`)
      yield* tx.run(`CREATE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
