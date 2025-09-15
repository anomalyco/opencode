import { text, mysqlTable, uniqueIndex, varchar, int } from "drizzle-orm/mysql-core"
import { timestamps, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const UserTable = mysqlTable(
  "user",
  {
    ...workspaceColumns,
    ...timestamps,
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    timeSeen: utc("time_seen"),
    color: int("color"),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("user_email").on(table.workspaceID, table.email)],
)
