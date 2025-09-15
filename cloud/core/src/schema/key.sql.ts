import { mysqlTable, varchar, uniqueIndex, json } from "drizzle-orm/mysql-core"
import { timestamps, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"
import { Actor } from "../actor"

export const KeyTable = mysqlTable(
  "key",
  {
    ...workspaceColumns,
    ...timestamps,
    actor: json("actor").$type<Actor.Info>(),
    name: varchar("name", { length: 255 }).notNull(),
    oldName: varchar("old_name", { length: 255 }),
    key: varchar("key", { length: 255 }).notNull(),
    timeUsed: utc("time_used"),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("global_key").on(table.key),
    uniqueIndex("name").on(table.workspaceID, table.name),
  ],
)
