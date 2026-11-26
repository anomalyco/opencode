export * as Driver from "./driver.postgres.js"

import type { Layer } from "effect"
import type { SqlClient } from "effect/sql"
import { Postgres } from "./postgres.node.js"
import { PgApply } from "./pg/apply.js"

export const kind = "postgres" as const
export const supportsTuningPragmas = false
export const supportsForeignKeyToggle = false
export const EffectDrizzle = Postgres.EffectDrizzlePostgres
export const makeWithDefaults = Postgres.makeWithDefaults
export type Database = Postgres.Database

// PostgreSQL always manages transactions in the client, never with SQL statements.
export const managesTransactionsNatively = (_client: SqlClient.SqlClient): boolean => true

export interface Options {
  readonly path?: string
  readonly url?: string
  readonly maxConnections?: number
}

export const layer = (options: Options): Layer.Layer<SqlClient.SqlClient> =>
  Postgres.clientLayer({
    url: options.url ?? process.env.OPENCODE_PG_DSN,
    maxConnections: options.maxConnections ?? Number(process.env.OPENCODE_PG_POOL ?? 8),
  })

export const applyMigrations = (db: Database, _options: { legacyCredentials?: boolean } = {}) => PgApply.apply(db)
