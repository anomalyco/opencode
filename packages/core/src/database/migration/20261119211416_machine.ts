import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261119211416_machine",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`machine\` (
          \`id\` text PRIMARY KEY,
          \`time_created\` integer NOT NULL
        );
      `)
    })
  },
}

export default migration
