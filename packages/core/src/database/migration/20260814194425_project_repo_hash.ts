import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260814194425_project_repo_hash",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`repo_hash\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
