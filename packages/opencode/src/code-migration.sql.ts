import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const CodeMigrationTable = sqliteTable("code_migration", {
  name: text().primaryKey(),
  time_completed: integer().notNull(),
})
