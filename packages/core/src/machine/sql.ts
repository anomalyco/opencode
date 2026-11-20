import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { Environment } from "../environment/index.js"

export const MachineTable = sqliteTable(
  "machine",
  {
    id: text().$type<Environment.ID>().primaryKey(),
    /** The machine's public key, base64url, once it has joined. Null until then. */
    key: text(),
    time_created: integer().notNull(),
  },
  (table) => [uniqueIndex("machine_key_idx").on(table.key)],
)
