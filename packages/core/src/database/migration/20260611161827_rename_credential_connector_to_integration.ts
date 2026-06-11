import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260611161827_rename_credential_connector_to_integration",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`credential\` RENAME COLUMN \`connector_id\` TO \`integration_id\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`credential_connector_active_idx\`;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`credential_integration_active_idx\` ON \`credential\` (\`integration_id\`) WHERE "credential"."active" = 1;`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
