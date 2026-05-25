import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const DataMigrationTable = sqliteTable("data_migration", {
  name: text().primaryKey(),
  time_completed: integer().notNull(),
})
