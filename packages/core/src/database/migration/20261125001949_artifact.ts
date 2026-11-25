import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261125001949_artifact",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`artifact\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`session_id\` text,
          \`directory\` text NOT NULL,
          \`provider\` text NOT NULL,
          \`title\` text NOT NULL,
          \`entry\` text NOT NULL,
          \`url\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`artifact_project_idx\` ON \`artifact\` (\`project_id\`,\`time_updated\`);`)
      yield* tx.run(`CREATE INDEX \`artifact_session_idx\` ON \`artifact\` (\`session_id\`);`)
      // Artifacts were KV records at `artifact:item:<id>`. The key range, not LIKE, keeps `_` from matching any
      // character.
      yield* tx.run(`
        INSERT INTO \`artifact\` (
          \`id\`, \`project_id\`, \`session_id\`, \`directory\`, \`provider\`, \`title\`, \`entry\`, \`url\`, \`time_created\`, \`time_updated\`
        )
        SELECT
          json_extract(\`value\`, '$.info.id'),
          json_extract(\`value\`, '$.projectID'),
          json_extract(\`value\`, '$.info.sessionID'),
          json_extract(\`value\`, '$.directory'),
          json_extract(\`value\`, '$.info.provider'),
          json_extract(\`value\`, '$.info.title'),
          json_extract(\`value\`, '$.info.entry'),
          json_extract(\`value\`, '$.info.url'),
          json_extract(\`value\`, '$.info.time.created'),
          json_extract(\`value\`, '$.info.time.updated')
        FROM \`kv\`
        WHERE \`key\` >= 'artifact:item:' AND \`key\` < 'artifact:item;'
      `)
      yield* tx.run(`DELETE FROM \`kv\` WHERE \`key\` >= 'artifact:item:' AND \`key\` < 'artifact:item;'`)
    })
  },
}

export default migration
