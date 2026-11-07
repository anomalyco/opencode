import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261105050139_held_report",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`held_report_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`held_report_at\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`held_report_answer\` text;`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_held_report_idx\` ON \`session_v2\` (\`held_report_id\`) WHERE "session_v2"."held_report_id" is not null;`,
      )
    })
  },
}

export default migration
