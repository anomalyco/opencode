import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Environment } from "../environment/index.js"

export const MachineTable = sqliteTable("machine", {
  id: text().$type<Environment.ID>().primaryKey(),
  time_created: integer().notNull(),
})
