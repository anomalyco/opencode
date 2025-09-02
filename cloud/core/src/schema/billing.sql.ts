import { bigint, boolean, int, mysqlTable, varchar } from "drizzle-orm/mysql-core"
import { timestamps, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const BillingTable = mysqlTable(
  "billing",
  {
    ...workspaceColumns,
    ...timestamps,
    customerID: varchar("customer_id", { length: 255 }),
    paymentMethodID: varchar("payment_method_id", { length: 255 }),
    paymentMethodLast4: varchar("payment_method_last4", { length: 4 }),
    balance: bigint("balance", { mode: "number" }).notNull(),
    reload: boolean("reload"),
  },
  (table) => [...workspaceIndexes(table)],
)

export const PaymentTable = mysqlTable(
  "payment",
  {
    ...workspaceColumns,
    ...timestamps,
    customerID: varchar("customer_id", { length: 255 }),
    paymentID: varchar("payment_id", { length: 255 }),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (table) => [...workspaceIndexes(table)],
)

export const UsageTable = mysqlTable(
  "usage",
  {
    ...workspaceColumns,
    ...timestamps,
    model: varchar("model", { length: 255 }).notNull(),
    inputTokens: int("input_tokens").notNull(),
    outputTokens: int("output_tokens").notNull(),
    reasoningTokens: int("reasoning_tokens"),
    cacheReadTokens: int("cache_read_tokens"),
    cacheWriteTokens: int("cache_write_tokens"),
    cost: bigint("cost", { mode: "number" }).notNull(),
  },
  (table) => [...workspaceIndexes(table)],
)
