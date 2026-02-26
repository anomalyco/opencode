import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { TeamTable } from "./team.sql"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TeamMessageTable = sqliteTable(
  "team_message",
  {
    id: text().primaryKey(),
    team_id: text()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    from_session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    to_session_id: text().references(() => SessionTable.id),
    content: text().notNull(),
    read: integer({ mode: "boolean" }).notNull().default(false),
    ...Timestamps,
  },
  (table) => [
    index("team_message_team_idx").on(table.team_id),
    index("team_message_to_idx").on(table.to_session_id),
    index("team_message_from_idx").on(table.from_session_id),
  ],
)
