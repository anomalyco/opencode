import { mysqlTable, int, primaryKey, varchar } from "drizzle-orm/mysql-core"
import { timestamps } from "../drizzle/types"

export const IpTable = mysqlTable(
  "ip",
  {
    ip: varchar("ip", { length: 45 }).notNull(),
    ...timestamps,
    usage: int("usage"),
  },
  (table) => [primaryKey({ columns: [table.ip] })],
)

export const IpRateLimitTable = mysqlTable(
  "ip_rate_limit",
  {
    ip: varchar("ip", { length: 45 }).notNull(),
    interval: varchar("interval", { length: 10 }).notNull(),
    count: int("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ip, table.interval] })],
)
