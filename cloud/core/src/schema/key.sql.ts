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
    key: varchar("key", { length: 255 }).notNull(),
    timeUsed: utc("time_used"),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("global_key").on(table.key)],
)
