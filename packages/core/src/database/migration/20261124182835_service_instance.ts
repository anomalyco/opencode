import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261124182835_service_instance",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`service_instance\` (
          \`key\` text PRIMARY KEY,
          \`value\` text NOT NULL
        );
      `)
    })
  },
}

export default migration
