import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Layer } from "effect"
import type { SqlClient } from "effect/sql"

export const supportsTuningPragmas = true

// Foreign keys default OFF and can be toggled per connection.
export const supportsForeignKeyToggle = true

// Opening the database can only fail on a broken file or a lock held past
// busyTimeout; Database.layer treats both as fatal.
export const sqliteLayer = (config: SqliteClient.SqliteClientConfig): Layer.Layer<SqlClient.SqlClient> =>
  Layer.orDie(SqliteClient.layer(config))
