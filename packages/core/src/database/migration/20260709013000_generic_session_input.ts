import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260709013000_generic_session_input",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        DELETE FROM \`event\`
        WHERE \`type\` IN ('session.prompt.admitted.1', 'session.prompt.promoted.1')
          AND json_extract(\`data\`, '$.inputID') IN (
            SELECT \`id\` FROM \`session_input\` WHERE \`type\` = 'prompt' AND \`prompt\` IS NULL
          );
      `)
      yield* tx.run(`
        CREATE TABLE \`__new_session_input\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          \`delivery\` text,
          \`admitted_seq\` integer NOT NULL,
          \`promoted_seq\` integer,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_input_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        INSERT INTO \`__new_session_input\`(
          \`id\`, \`session_id\`, \`type\`, \`data\`, \`delivery\`, \`admitted_seq\`, \`promoted_seq\`, \`time_created\`
        )
        SELECT
          \`id\`, \`session_id\`, CASE WHEN \`type\` = 'prompt' THEN 'user' ELSE \`type\` END,
          CASE WHEN \`type\` = 'prompt' THEN \`prompt\` ELSE '{}' END,
          \`delivery\`, \`admitted_seq\`, \`promoted_seq\`, \`time_created\`
        FROM \`session_input\`
        WHERE \`type\` != 'prompt' OR \`prompt\` IS NOT NULL;
      `)
      yield* tx.run(`DROP TABLE \`session_input\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session_input\` RENAME TO \`session_input\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(
        `CREATE INDEX \`session_input_session_pending_delivery_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_pending_compaction_idx\` ON \`session_input\` (\`session_id\`) WHERE \`type\` = 'compaction' and \`promoted_seq\` is null;`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_admitted_seq_idx\` ON \`session_input\` (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_input_session_promoted_seq_idx\` ON \`session_input\` (\`session_id\`,\`promoted_seq\`);`,
      )
      yield* tx.run(`
        UPDATE \`event\`
        SET
          \`type\` = 'session.input.admitted.1',
          \`data\` = json_object(
            'sessionID', json_extract(\`data\`, '$.sessionID'),
            'inputID', json_extract(\`data\`, '$.inputID'),
            'input', json_object(
              'type', 'user',
              'data', json_extract(\`data\`, '$.prompt'),
              'delivery', json_extract(\`data\`, '$.delivery')
            )
          )
        WHERE \`type\` = 'session.prompt.admitted.1';
      `)
      yield* tx.run(`
        UPDATE \`event\`
        SET \`type\` = 'session.input.promoted.1'
        WHERE \`type\` = 'session.prompt.promoted.1';
      `)
    })
  },
} satisfies DatabaseMigration.Migration
