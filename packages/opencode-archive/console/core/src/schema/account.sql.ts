import { mysqlTable, primaryKey } from "drizzle-orm/mysql-core"
import { id, timestamps } from "../drizzle/types"

export const AccountTable = mysqlTable(
  "account",
  {
    id: id(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.id] })],
)
