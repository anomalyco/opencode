import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261125002931_artifact-provider",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`artifact\` ADD \`visibility\` text;`)
      yield* tx.run(`ALTER TABLE \`artifact\` ADD \`destination\` text;`)
      yield* tx.run(
        `ALTER TABLE \`artifact\` ADD \`manifest\` text DEFAULT '{"spa":false,"bindings":[],"crons":[]}' NOT NULL;`,
      )
      yield* tx.run(`ALTER TABLE \`artifact\` ADD \`receipt\` text;`)
      // Before providers declared audiences, Console's artifacts were its members' and local ones this server's.
      yield* tx.run(`UPDATE \`artifact\` SET \`visibility\` = 'private' WHERE \`provider\` = 'console';`)
      yield* tx.run(
        `UPDATE \`artifact\` SET \`visibility\` = 'local', \`destination\` = 'local' WHERE \`provider\` = 'local';`,
      )
    })
  },
}

export default migration
