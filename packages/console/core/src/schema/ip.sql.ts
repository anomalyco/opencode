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

export const KeyRateLimitTable = mysqlTable(
  "key_rate_limit",
  {
    key: varchar("key", { length: 255 }).notNull(),
    interval: varchar("interval", { length: 40 }).notNull(),
    count: int("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.interval] })],
)

export const ModelTpmLimitTable = mysqlTable(
  "model_tpm_limit",
  {
    id: varchar("id", { length: 255 }).notNull(),
    count: int("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id] })],
)

export const ModelRateLimitTable = mysqlTable(
  "model_rate_limit",
  {
    key: varchar("key", { length: 255 }).notNull(),
    interval: varchar("interval", { length: 40 }).notNull(),
    count: int("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.interval] })],
)
