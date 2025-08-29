import { bigint, boolean, integer, pgTable, varchar } from "drizzle-orm/pg-core"
import { timestamps, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const BillingTable = pgTable(
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

export const PaymentTable = pgTable(
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

export const UsageTable = pgTable(
  "usage",
  {
    ...workspaceColumns,
    ...timestamps,
    model: varchar("model", { length: 255 }).notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    reasoningTokens: integer("reasoning_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    cost: bigint("cost", { mode: "number" }).notNull(),
  },
  (table) => [...workspaceIndexes(table)],
)
