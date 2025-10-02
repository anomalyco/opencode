import { mysqlTable, uniqueIndex, varchar, int, mysqlEnum } from "drizzle-orm/mysql-core"
import { timestamps, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const UserRole = ["admin", "member"] as const

export const UserTable = mysqlTable(
  "user",
  {
    ...workspaceColumns,
    ...timestamps,
    email: varchar("email", { length: 255 }),
    oldEmail: varchar("old_email", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    timeSeen: utc("time_seen"),
    color: int("color"),
    role: mysqlEnum("role", UserRole).notNull(),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("user_email").on(table.workspaceID, table.email)],
)
