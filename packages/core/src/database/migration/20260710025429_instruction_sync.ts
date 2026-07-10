import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260710025429_instruction_sync",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`fork_seq\` integer;`)
      yield* tx.run(`ALTER TABLE \`instruction_entry\` ADD \`removed\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(`
        CREATE TABLE \`instruction_blob\` (
          \`hash\` text PRIMARY KEY,
          \`value\` text NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`instruction_state\` (
          \`session_id\` text PRIMARY KEY,
          \`epoch_start\` integer NOT NULL,
          \`through_seq\` integer NOT NULL,
          \`initial_values\` text NOT NULL,
          \`current_values\` text NOT NULL,
          CONSTRAINT \`fk_instruction_state_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      // Retain legacy prose under a distinct read-only event type so current
      // clients have one unambiguous instructions.updated payload.
      yield* tx.run(`
        UPDATE \`event\`
        SET \`type\` = 'session.instructions.legacy.1'
        WHERE \`type\` = 'session.instructions.updated.1';
      `)
      yield* tx.run(`DELETE FROM \`session_message\` WHERE \`type\` = 'system';`)
      yield* tx.run(`
        UPDATE \`session\`
        SET \`fork_seq\` = COALESCE(
          (
            SELECT MIN(\`seq\`) - 1
            FROM \`event\`
            WHERE \`aggregate_id\` = \`session\`.\`id\` AND \`seq\` > 0
          ),
          (
            SELECT \`seq\`
            FROM \`event_sequence\`
            WHERE \`aggregate_id\` = \`session\`.\`id\`
          ),
          0
        )
        WHERE \`fork_session_id\` IS NOT NULL;
      `)
      yield* tx.run(`
        UPDATE \`event\`
        SET
          \`type\` = 'session.forked.2',
          \`data\` = json_set(
            \`data\`,
            '$.parentSeq',
            COALESCE(
              (SELECT \`fork_seq\` FROM \`session\` WHERE \`id\` = \`event\`.\`aggregate_id\`),
              0
            )
          )
        WHERE \`type\` = 'session.forked.1';
      `)
      yield* tx.run(`DROP TABLE \`instruction_checkpoint\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
