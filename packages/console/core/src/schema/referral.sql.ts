import { bigint, index, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const ReferralRewardSource = ["inviter", "invitee"] as const

export const ReferralCodeTable = mysqlTable(
  "referral_code",
  {
    ...workspaceColumns,
    ...timestamps,
    code: varchar("code", { length: 10 }).notNull(),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("referral_code_workspace_id").on(table.workspaceID),
    uniqueIndex("referral_code_code").on(table.code),
  ],
)

export const ReferralTable = mysqlTable(
  "referral",
  {
    ...workspaceColumns,
    ...timestamps,
    inviterWorkspaceID: ulid("inviter_workspace_id").notNull(),
    inviteeAccountID: ulid("invitee_account_id").notNull(),
    inviteeUserID: ulid("invitee_user_id").notNull(),
    referralCodeID: ulid("referral_code_id").notNull(),
    stripeCustomerID: varchar("stripe_customer_id", { length: 255 }).notNull(),
    stripeSubscriptionID: varchar("stripe_subscription_id", { length: 255 }).notNull(),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("referral_invitee_account_id").on(table.inviteeAccountID),
    uniqueIndex("referral_stripe_subscription_id").on(table.stripeSubscriptionID),
    index("referral_inviter_workspace_id").on(table.inviterWorkspaceID),
    index("referral_code_id").on(table.referralCodeID),
  ],
)

export const ReferralRewardTable = mysqlTable(
  "referral_reward",
  {
    ...workspaceColumns,
    ...timestamps,
    referralID: ulid("referral_id").notNull(),
    source: mysqlEnum("source", ReferralRewardSource).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    appliedByUserID: ulid("applied_by_user_id"),
    timeApplied: utc("time_applied"),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("referral_reward_referral_source").on(table.referralID, table.source),
    index("referral_reward_workspace_time").on(table.workspaceID, table.timeCreated),
  ],
)
