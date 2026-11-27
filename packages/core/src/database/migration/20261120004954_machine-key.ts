import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261120004954_machine-key",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`machine\` ADD \`key\` text;`)
      yield* tx.run(`CREATE UNIQUE INDEX \`machine_key_idx\` ON \`machine\` (\`key\`);`)
    })
  },
}

export default migration
