import { integer, table, text } from "./database/dialect"

export const DataMigrationTable = table("data_migration", {
  name: text().primaryKey(),
  time_completed: integer().notNull(),
})
