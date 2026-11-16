import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261116055456_video_blob_expiry",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`blob\` ADD \`expires_at\` integer;`)
      yield* tx.run(
        `CREATE INDEX \`blob_expires_at_idx\` ON \`blob\` (\`expires_at\`) WHERE "blob"."expires_at" IS NOT NULL;`,
      )
    })
  },
}

export default migration
