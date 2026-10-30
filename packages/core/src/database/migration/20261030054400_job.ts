import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261030054400_job",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`job\` (
          \`notification_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`child_session_id\` text,
          \`kind\` text NOT NULL,
          \`title\` text,
          \`status\` text NOT NULL,
          \`output\` text,
          \`error\` text,
          \`recovery\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`job_session_idx\` ON \`job\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`job_child_session_idx\` ON \`job\` (\`child_session_id\`);`)
      yield* tx.run(`CREATE INDEX \`job_id_idx\` ON \`job\` (\`id\`);`)
      yield* tx.run(`
        INSERT OR IGNORE INTO \`job\` (
          \`notification_id\`, \`id\`, \`session_id\`, \`child_session_id\`, \`kind\`, \`title\`,
          \`status\`, \`output\`, \`error\`, \`recovery\`, \`time_created\`, \`time_updated\`
        )
        SELECT
          json_extract(\`value\`, '$.notificationID'),
          json_extract(\`value\`, '$.id'),
          COALESCE(json_extract(\`value\`, '$.recovery.sessionID'), json_extract(\`value\`, '$.recovery.parentSessionID')),
          json_extract(\`value\`, '$.recovery.childSessionID'),
          json_extract(\`value\`, '$.recovery.kind'),
          COALESCE(
            json_extract(\`value\`, '$.recovery.command'),
            json_extract(\`value\`, '$.recovery.description'),
            json_extract(\`value\`, '$.recovery.path')
          ),
          json_extract(\`value\`, '$.status'),
          json_extract(\`value\`, '$.output'),
          json_extract(\`value\`, '$.error'),
          json_extract(\`value\`, '$.recovery'),
          \`time_created\`,
          \`time_updated\`
        FROM \`kv\`
        WHERE \`key\` LIKE 'job.background/%'
          AND json_extract(\`value\`, '$.notificationID') IS NOT NULL
          AND json_extract(\`value\`, '$.id') IS NOT NULL
          AND COALESCE(json_extract(\`value\`, '$.recovery.sessionID'), json_extract(\`value\`, '$.recovery.parentSessionID')) IS NOT NULL;
      `)
      yield* tx.run(`DELETE FROM \`kv\` WHERE \`key\` LIKE 'job.background/%';`)
    })
  },
}

export default migration
