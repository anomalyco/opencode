import { mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { id, timestamps } from "../drizzle/types"

export const AccountTable = mysqlTable(
  "account",
  {
    id: id(),
    ...timestamps,
    email: varchar("email", { length: 255 }).notNull(),
  },
  (table) => [uniqueIndex("email").on(table.email)],
)
