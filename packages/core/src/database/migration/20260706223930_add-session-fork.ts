import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260706223930_add-session-fork",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`fork_session_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`fork_message_id\` text;`)
      yield* tx.run(`
        UPDATE \`session\`
        SET
          \`parent_id\` = NULL,
          \`fork_session_id\` = (
            SELECT json_extract(\`event\`.\`data\`, '$.parentID')
            FROM \`event\`
            WHERE \`event\`.\`aggregate_id\` = \`session\`.\`id\`
              AND \`event\`.\`type\` = 'session.forked'
            ORDER BY \`event\`.\`seq\`
            LIMIT 1
          ),
          \`fork_message_id\` = (
            SELECT json_extract(\`event\`.\`data\`, '$.from')
            FROM \`event\`
            WHERE \`event\`.\`aggregate_id\` = \`session\`.\`id\`
              AND \`event\`.\`type\` = 'session.forked'
            ORDER BY \`event\`.\`seq\`
            LIMIT 1
          )
        WHERE EXISTS (
          SELECT 1
          FROM \`event\`
          WHERE \`event\`.\`aggregate_id\` = \`session\`.\`id\`
            AND \`event\`.\`type\` = 'session.forked'
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
