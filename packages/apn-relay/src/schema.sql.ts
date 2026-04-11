import { bigint, index, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core"

export const device_registration = mysqlTable(
  "device_registration",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    secret_hash: varchar("secret_hash", { length: 64 }).notNull(),
    device_token: varchar("device_token", { length: 255 }).notNull(),
    bundle_id: varchar("bundle_id", { length: 255 }).notNull(),
    apns_env: varchar("apns_env", { length: 16 }).notNull().default("production"),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    updated_at: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("device_registration_secret_token_idx").on(table.secret_hash, table.device_token),
    index("device_registration_secret_hash_idx").on(table.secret_hash),
  ],
)

export const delivery_log = mysqlTable(
  "delivery_log",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    secret_hash: varchar("secret_hash", { length: 64 }).notNull(),
    event_type: varchar("event_type", { length: 32 }).notNull(),
    session_id: varchar("session_id", { length: 255 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    error: varchar("error", { length: 1024 }),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("delivery_log_secret_hash_idx").on(table.secret_hash),
    index("delivery_log_created_at_idx").on(table.created_at),
  ],
)
