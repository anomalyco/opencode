import { bigint, pgTable, text } from "drizzle-orm/pg-core"

export const PgDataMigrationTable = pgTable("data_migration", {
  name: text().primaryKey(),
  time_completed: bigint({ mode: "number" }).notNull(),
})
