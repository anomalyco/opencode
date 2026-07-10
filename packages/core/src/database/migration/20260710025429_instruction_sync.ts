import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260710025429_instruction_sync",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`fork_seq\` integer;`)
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_instruction_entry\` (
          \`session_id\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text,
          \`removed\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`instruction_entry_pk\` PRIMARY KEY(\`session_id\`, \`key\`),
          CONSTRAINT \`fk_instruction_entry_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        INSERT INTO \`__new_instruction_entry\`(
          \`session_id\`, \`key\`, \`value\`, \`removed\`, \`time_created\`, \`time_updated\`
        )
        SELECT \`session_id\`, \`key\`, \`value\`, false, \`time_created\`, \`time_updated\`
        FROM \`instruction_entry\`;
      `)
      yield* tx.run(`DROP TABLE \`instruction_entry\`;`)
      yield* tx.run(`ALTER TABLE \`__new_instruction_entry\` RENAME TO \`instruction_entry\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(`
        CREATE TABLE \`instruction_blob\` (
          \`hash\` text PRIMARY KEY,
          \`value\` text
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
      // Persisted System rows were exclusively pre-beta instruction prose,
      // including fork copies whose message IDs no longer match the source event.
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
      yield* tx.run(`DELETE FROM \`event\` WHERE \`type\` = 'session.instructions.updated.1';`)
      yield* tx.run(`DROP TABLE \`instruction_checkpoint\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
