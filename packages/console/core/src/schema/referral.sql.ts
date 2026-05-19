import { bigint, mysqlTable, primaryKey, uniqueIndex } from "drizzle-orm/mysql-core"
import { timestamps, ulid, utc, workspaceColumns } from "../drizzle/types"
import { workspaceIndexes } from "./workspace.sql"

export const ReferralTable = mysqlTable(
  "referral",
  {
    ...workspaceColumns,
    ...timestamps,
    inviteeAccountID: ulid("invitee_account_id").notNull(),
  },
  (table) => [
    ...workspaceIndexes(table),
    uniqueIndex("referral_invitee_account_id").on(table.inviteeAccountID),
  ],
)

export const ReferralRewardTable = mysqlTable(
  "referral_reward",
  {
    workspaceID: ulid("workspace_id").notNull(),
    referralID: ulid("referral_id").notNull(),
    ...timestamps,
    amount: bigint("amount", { mode: "number" }).notNull(),
    timeApplied: utc("time_applied"),
  },
  (table) => [primaryKey({ columns: [table.workspaceID, table.referralID] })],
)
