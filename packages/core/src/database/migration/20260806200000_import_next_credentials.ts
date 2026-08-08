import path from "node:path"
import { existsSync } from "node:fs"
import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Credential } from "@opencode-ai/schema/credential"
import { Global } from "@opencode-ai/util/global"
import type { DatabaseMigration } from "../migration"

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeValue = Schema.decodeUnknownOption(Credential.Value)

export default {
  id: "20260806200000_import_next_credentials",
  up(tx) {
    return importNextCredentials(tx, path.join(Global.Path.data, "opencode-next.db"))
  },
} satisfies DatabaseMigration.Migration

/**
 * The next channel stored credentials in its own `opencode-next.db` before the
 * channel databases were consolidated into `opencode.db`. The legacy import
 * only reads V1 `auth.json`, so a credential that existed only in the previous
 * channel database was silently dropped. Copy those rows over, keeping any
 * credential the target database already has for the same integration.
 */
export function importNextCredentials(tx: Parameters<DatabaseMigration.Migration["up"]>[0], sourcePath: string) {
  return Effect.gen(function* () {
    if (!existsSync(sourcePath)) return
    for (const row of yield* readSourceCredentials(sourcePath)) {
      const integrationID = typeof row.integration_id === "string" && row.integration_id.length ? row.integration_id : undefined
      if (!integrationID) continue
      if (typeof row.value !== "string") continue
      const json = Option.getOrUndefined(decodeJson(row.value))
      if (json === undefined || Option.isNone(decodeValue(json))) continue
      if (yield* tx.get(sql`SELECT id FROM credential WHERE integration_id = ${integrationID}`)) continue
      const now = Date.now()
      yield* tx.run(sql`
        INSERT OR IGNORE INTO credential (
          id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated
        ) VALUES (
          ${typeof row.id === "string" && row.id.length ? row.id : Credential.ID.create()},
          ${integrationID},
          ${typeof row.label === "string" && row.label.length ? row.label : "default"},
          ${row.value},
          ${typeof row.connector_id === "string" ? row.connector_id : null},
          ${typeof row.method_id === "string" ? row.method_id : null},
          ${typeof row.active === "number" ? row.active : null},
          ${typeof row.time_created === "number" ? row.time_created : now},
          ${typeof row.time_updated === "number" ? row.time_updated : now}
        )
      `)
    }
  })
}

type SourceRow = Record<string, unknown>

// An unreadable or incompatible source database skips the import instead of
// failing the migration and blocking startup; the source is never modified.
function readSourceCredentials(sourcePath: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const sqlite = yield* Effect.promise(() => import("bun:sqlite"))
      const source = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new sqlite.Database(sourcePath, { readonly: true, strict: true }),
          catch: (error) => error,
        }),
        (database) => Effect.sync(() => database.close()),
      )
      return yield* Effect.try({
        try: () => {
          const table = source
            .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credential'")
            .get()
          if (!table) return [] as SourceRow[]
          return source.query<SourceRow, []>("SELECT * FROM credential").all()
        },
        catch: (error) => error,
      })
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Skipped incompatible opencode-next.db credentials", { path: sourcePath, error }).pipe(
        Effect.as([] as SourceRow[]),
      ),
    ),
  )
}
