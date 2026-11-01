import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261030204714_job_subagent",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`job\` ADD \`pending\` integer DEFAULT true NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`job\` ADD \`reported\` text;`)
      yield* tx.run(`ALTER TABLE \`job\` ADD \`dirty\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(
        `DELETE FROM \`job\` WHERE \`child_session_id\` IS NOT NULL AND \`rowid\` NOT IN (SELECT MAX(\`rowid\`) FROM \`job\` WHERE \`child_session_id\` IS NOT NULL GROUP BY \`child_session_id\`);`,
      )
      yield* tx.run(`DROP INDEX IF EXISTS \`job_child_session_idx\`;`)
      yield* tx.run(`CREATE UNIQUE INDEX \`job_child_session_idx\` ON \`job\` (\`child_session_id\`);`)
      yield* tx.run(
        `UPDATE \`job\` SET \`reported\` = CASE WHEN \`status\` IN ('completed', 'error') THEN (SELECT \`id\` FROM \`session_message\` WHERE \`session_id\` = \`job\`.\`child_session_id\` AND \`type\` = 'idle' ORDER BY \`seq\` DESC LIMIT 1 OFFSET 1) ELSE (SELECT \`id\` FROM \`session_message\` WHERE \`session_id\` = \`job\`.\`child_session_id\` AND \`type\` = 'idle' ORDER BY \`seq\` DESC LIMIT 1) END, \`dirty\` = CASE WHEN \`status\` IN ('completed', 'error') THEN 1 ELSE 0 END WHERE \`kind\` = 'subagent';`,
      )
    })
  },
}

export default migration
