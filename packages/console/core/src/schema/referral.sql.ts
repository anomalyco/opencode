import { bigint, index, mysqlTable, uniqueIndex } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc } from "../drizzle/types"

export const ReferralTable = mysqlTable(
  "referral",
  {
    id: ulid("id").notNull().primaryKey(),
    workspaceID: ulid("workspace_id").notNull(),
    ...timestamps,
    inviteeAccountID: ulid("invitee_account_id").notNull(),
  },
  (table) => [
    uniqueIndex("referral_invitee_account_id").on(table.inviteeAccountID),
    index("referral_workspace_id").on(table.workspaceID),
  ],
)

export const ReferralRewardTable = mysqlTable(
  "referral_reward",
  {
    id: ulid("id").notNull().primaryKey(),
    workspaceID: ulid("workspace_id"),
    ...timestamps,
    referralID: ulid("referral_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    timeApplied: utc("time_applied"),
  },
  (table) => [index("referral_reward_workspace_time").on(table.workspaceID, table.timeCreated)],
)
