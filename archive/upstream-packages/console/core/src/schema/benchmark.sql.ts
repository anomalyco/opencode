import { index, mediumtext, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core"
import { id, timestamps } from "../drizzle/types"

export const BenchmarkTable = mysqlTable(
  "benchmark",
  {
    id: id(),
    ...timestamps,
    model: varchar("model", { length: 64 }).notNull(),
    agent: varchar("agent", { length: 64 }).notNull(),
    result: mediumtext("result").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id] }), index("time_created").on(table.timeCreated)],
)
