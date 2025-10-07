import { mysqlTable, uniqueIndex, varchar, int, mysqlEnum, index } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const UserRole = ["admin", "member"] as const

export const UserTable = mysqlTable(
  "user",
  {
    ...workspaceColumns,
    ...timestamps,
    accountID: ulid("account_id"),
    email: varchar("email", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    timeSeen: utc("time_seen"),
    color: int("color"),
    role: mysqlEnum("role", UserRole).notNull(),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("user_account_id").on(table.workspaceID, table.accountID),
    uniqueIndex("user_email").on(table.workspaceID, table.email),
    index("global_account_id").on(table.accountID),
    index("global_email").on(table.email),
  ],
)
