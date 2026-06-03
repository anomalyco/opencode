import { DatabaseDialect } from "./dialect"
import { Timestamps as SqliteTimestamps } from "./schema.sql"
import { PgTimestamps } from "./schema.pg"

export const isPostgres = DatabaseDialect.isPostgres()

export const Timestamps = DatabaseDialect.isPostgres() ? PgTimestamps : SqliteTimestamps

export { PgTimestamps }
export { Timestamps as SqliteTimestamps } from "./schema.sql"
