import { index, mysqlEnum, mysqlTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { id, timestamps, ulid } from "../drizzle/types"

export const AuthProvider = ["email", "github", "google"] as const

export const AuthTable = mysqlTable(
  "auth",
  {
    id: id(),
    ...timestamps,
    provider: mysqlEnum("provider", AuthProvider).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    accountID: ulid("account_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("provider").on(table.provider, table.subject),
    index("account_id").on(table.accountID),
  ],
)
