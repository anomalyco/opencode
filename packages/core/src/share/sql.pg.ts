import { pgTable, text } from "drizzle-orm/pg-core"
import { PgSessionTable } from "../session/sql.pg"
import { PgTimestamps } from "../database/schema.pg"

export const PgSessionShareTable = pgTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => PgSessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  ...PgTimestamps,
})
