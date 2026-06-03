import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { DatabaseDialect } from "./database/dialect"
import { PgDataMigrationTable } from "./data-migration.sql.pg"

const _SqliteDataMigrationTable = sqliteTable("data_migration", {
  name: text().primaryKey(),
  time_completed: integer().notNull(),
})

type SqliteDataMigrationTable = typeof _SqliteDataMigrationTable

export const DataMigrationTable: SqliteDataMigrationTable = DatabaseDialect.isPostgres() ? PgDataMigrationTable as any : _SqliteDataMigrationTable
