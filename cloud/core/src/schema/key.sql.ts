import { text, mysqlTable, varchar, uniqueIndex } from "drizzle-orm/mysql-core"
import { timestamps, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const KeyTable = mysqlTable(
  "key",
  {
    ...workspaceColumns,
    ...timestamps,
    userID: text("user_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    timeUsed: utc("time_used"),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("global_key").on(table.key)],
)
