export * as Driver from "./driver.sqlite.js"

import type { Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { EffectDrizzleSqlite } from "./drizzle.js"
import { DatabaseMigration } from "./migration.js"
import { sqliteLayer, supportsForeignKeyToggle, supportsTuningPragmas } from "#sqlite"

export const kind = "sqlite" as const
export { supportsForeignKeyToggle, supportsTuningPragmas }
export const EffectDrizzle = EffectDrizzleSqlite
export const makeWithDefaults = EffectDrizzleSqlite.makeWithDefaults
export type Database = EffectDrizzleSqlite.EffectSQLiteDatabase & { readonly $client?: SqlClient.SqlClient }

export const managesTransactionsNatively = (client: SqlClient.SqlClient): boolean =>
  EffectDrizzleSqlite.managesTransactionsNatively(client)

export interface Options {
  readonly path?: string
  readonly url?: string
  readonly maxConnections?: number
}

export const layer = (options: Options): Layer.Layer<SqlClient.SqlClient> =>
  sqliteLayer({ filename: options.path ?? ":memory:" })

export const applyMigrations = (db: Database, options: { legacyCredentials?: boolean } = {}) =>
  DatabaseMigration.apply(db, { legacyCredentials: options.legacyCredentials ?? true })
