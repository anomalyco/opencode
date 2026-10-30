import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261030154322_automation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`schedule_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`schedule_due_idx\`;`)
      yield* tx.run(`ALTER TABLE \`schedule\` RENAME TO \`automation\`;`)
      yield* tx.run(`UPDATE \`automation\` SET \`id\` = 'aut_' || substr(\`id\`, 5) WHERE \`id\` LIKE 'sch_%';`)
      yield* tx.run(`CREATE INDEX \`automation_session_idx\` ON \`automation\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`automation_due_idx\` ON \`automation\` (\`next_due_at\`) WHERE "automation"."status" = 'active' and "automation"."next_due_at" is not null;`,
      )
    })
  },
}

export default migration
