import { text, pgTable, uniqueIndex, varchar, integer } from "drizzle-orm/pg-core"
import { timestamps, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const UserTable = pgTable(
  "user",
  {
    ...workspaceColumns,
    ...timestamps,
    email: text("email").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    timeSeen: utc("time_seen"),
    color: integer("color"),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("user_email").on(table.workspaceID, table.email)],
)
