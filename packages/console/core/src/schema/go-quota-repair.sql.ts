import { json, mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { utc } from "../drizzle/types"
import type { GoQuotaRepair } from "../go-quota-repair"

export const GoQuotaRepairTable = mysqlTable("go_quota_repair", {
  key_hash: varchar({ length: 64 }).primaryKey(),
  receipt_id: varchar({ length: 36 }).notNull(),
  input: json().$type<GoQuotaRepair.Input>().notNull(),
  result: json().$type<GoQuotaRepair.Receipt>(),
  time_created: utc("time_created").notNull().defaultNow(),
})
