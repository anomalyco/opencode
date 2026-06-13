import { table, text, Timestamps } from "../database/dialect"
import { SessionTable } from "../session/sql"

export const SessionShareTable = table("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  ...Timestamps,
})
