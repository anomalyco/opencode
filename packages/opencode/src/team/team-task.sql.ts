import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { TeamTable } from "./team.sql"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const TeamTaskTable = sqliteTable(
  "team_task",
  {
    id: text().primaryKey(),
    team_id: text()
      .notNull()
      .references(() => TeamTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    status: text().notNull().$type<"pending" | "in_progress" | "completed">(),
    assigned_to: text().references(() => SessionTable.id),
    depends_on: text({ mode: "json" }).$type<string[]>(),
    ...Timestamps,
  },
  (table) => [
    index("team_task_team_idx").on(table.team_id),
    index("team_task_assigned_idx").on(table.assigned_to),
  ],
)
