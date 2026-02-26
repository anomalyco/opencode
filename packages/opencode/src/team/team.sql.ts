import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TeamTable = sqliteTable(
  "team",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    lead_session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    status: text().notNull().$type<"active" | "archived">(),
    ...Timestamps,
  },
  (table) => [index("team_lead_idx").on(table.lead_session_id)],
)
