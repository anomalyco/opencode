import { bigint, boolean, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const BillingTable = mysqlTable(
  "billing",
  {
    ...workspaceColumns,
    ...timestamps,
    customerID: varchar("customer_id", { length: 255 }),
    paymentMethodID: varchar("payment_method_id", { length: 255 }),
    paymentMethodType: varchar("payment_method_type", { length: 32 }),
    paymentMethodLast4: varchar("payment_method_last4", { length: 4 }),
    balance: bigint("balance", { mode: "number" }).notNull(),
    monthlyLimit: int("monthly_limit"),
    monthlyUsage: bigint("monthly_usage", { mode: "number" }),
    timeMonthlyUsageUpdated: utc("time_monthly_usage_updated"),
    reload: boolean("reload"),
    reloadTrigger: int("reload_trigger"),
    reloadAmount: int("reload_amount"),
    reloadError: varchar("reload_error", { length: 255 }),
    timeReloadError: utc("time_reload_error"),
    timeReloadLockedTill: utc("time_reload_locked_till"),
    subscriptionID: varchar("subscription_id", { length: 28 }),
    subscriptionCouponID: varchar("subscription_coupon_id", { length: 28 }),
    subscriptionPlan: mysqlEnum("subscription_plan", ["20", "100", "200"] as const),
    timeSubscriptionBooked: utc("time_subscription_booked"),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("global_customer_id").on(table.customerID),
    uniqueIndex("global_subscription_id").on(table.subscriptionID),
  ],
)

export const SubscriptionTable = mysqlTable(
  "subscription",
  {
    ...workspaceColumns,
    ...timestamps,
    userID: ulid("user_id").notNull(),
    rollingUsage: bigint("rolling_usage", { mode: "number" }),
    fixedUsage: bigint("fixed_usage", { mode: "number" }),
    timeRollingUpdated: utc("time_rolling_updated"),
    timeFixedUpdated: utc("time_fixed_updated"),
  },
  (table) => [...workspaceIndexes(table), uniqueIndex("workspace_user_id").on(table.workspaceID, table.userID)],
)

export const PaymentTable = mysqlTable(
  "payment",
  {
    ...workspaceColumns,
    ...timestamps,
    customerID: varchar("customer_id", { length: 255 }),
    invoiceID: varchar("invoice_id", { length: 255 }),
    paymentID: varchar("payment_id", { length: 255 }),
    amount: bigint("amount", { mode: "number" }).notNull(),
    timeRefunded: utc("time_refunded"),
    enrichment: json("enrichment").$type<
      | {
          type: "subscription"
          couponID?: string
        }
      | {
          type: "credit"
        }
    >(),
  },
  (table) => [...workspaceIndexes(table)],
)

export const UsageTable = mysqlTable(
  "usage",
  {
    ...workspaceColumns,
    ...timestamps,
    model: varchar("model", { length: 255 }).notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    inputTokens: int("input_tokens").notNull(),
    outputTokens: int("output_tokens").notNull(),
    reasoningTokens: int("reasoning_tokens"),
    cacheReadTokens: int("cache_read_tokens"),
    cacheWrite5mTokens: int("cache_write_5m_tokens"),
    cacheWrite1hTokens: int("cache_write_1h_tokens"),
    cost: bigint("cost", { mode: "number" }).notNull(),
    keyID: ulid("key_id"),
    enrichment: json("enrichment").$type<{
      plan: "sub"
    }>(),
  },
  (table) => [...workspaceIndexes(table), index("usage_time_created").on(table.workspaceID, table.timeCreated)],
)
