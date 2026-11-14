import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261031060845_marketplace_local",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`marketplace_registry\` (
          \`id\` integer PRIMARY KEY,
          \`revision\` integer NOT NULL,
          \`installed\` text NOT NULL
        );
      `)
    })
  },
}

export default migration
