import { pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core"
import { id, timestamps } from "../drizzle/types"

export const AccountTable = pgTable(
  "account",
  {
    id: id(),
    ...timestamps,
    email: varchar("email", { length: 255 }).notNull(),
  },
  (table) => [uniqueIndex("email").on(table.email)],
)
