import { and, Database, eq, inArray, isNull } from "../src/drizzle/index.js"
import { Identifier } from "../src/identifier.js"
import { Referral } from "../src/referral.js"
import { LiteTable } from "../src/schema/billing.sql.js"
import { ReferralRewardTable, ReferralTable } from "../src/schema/referral.sql.js"
import { UserTable } from "../src/schema/user.sql.js"
import { WorkspaceTable } from "../src/schema/workspace.sql.js"

const backfills = [
  {
    inviterWorkspaceID: "wrk_00000000000000000000000000",
    inviteeWorkspaceID: "wrk_00000000000000000000000000",
    inviteeAccountID: "acc_00000000000000000000000000",
  },
]

console.log(`Backfilling ${backfills.length} referrals`)

for (const [index, backfill] of backfills.entries()) {
  console.log(`[${index + 1}/${backfills.length}] ${backfill.inviterWorkspaceID} -> ${backfill.inviteeWorkspaceID}`)
  console.log(`  invitee account: ${backfill.inviteeAccountID}`)

  const result = await Database.transaction(async (tx) => {
    if (backfill.inviterWorkspaceID === backfill.inviteeWorkspaceID) throw new Error("Self-referral workspace mismatch")

    const inviterWorkspace = await tx
      .select({ id: WorkspaceTable.id })
      .from(WorkspaceTable)
      .where(and(eq(WorkspaceTable.id, backfill.inviterWorkspaceID), isNull(WorkspaceTable.timeDeleted)))
      .then((rows) => rows[0])
    if (!inviterWorkspace) throw new Error(`Inviter workspace not found: ${backfill.inviterWorkspaceID}`)

    const inviteeWorkspace = await tx
      .select({ id: WorkspaceTable.id })
      .from(WorkspaceTable)
      .where(and(eq(WorkspaceTable.id, backfill.inviteeWorkspaceID), isNull(WorkspaceTable.timeDeleted)))
      .then((rows) => rows[0])
    if (!inviteeWorkspace) throw new Error(`Invitee workspace not found: ${backfill.inviteeWorkspaceID}`)

    const inviteeUser = await tx
      .select({ id: UserTable.id })
      .from(UserTable)
      .where(
        and(
          eq(UserTable.workspaceID, backfill.inviteeWorkspaceID),
          eq(UserTable.accountID, backfill.inviteeAccountID),
          eq(UserTable.role, "admin"),
          isNull(UserTable.timeDeleted),
        ),
      )
      .then((rows) => rows[0])
    if (!inviteeUser) throw new Error(`Invitee workspace owner not found: ${backfill.inviteeAccountID}`)

    const inviterUser = await tx
      .select({ id: UserTable.id })
      .from(UserTable)
      .where(
        and(
          eq(UserTable.workspaceID, backfill.inviterWorkspaceID),
          eq(UserTable.accountID, backfill.inviteeAccountID),
          isNull(UserTable.timeDeleted),
        ),
      )
      .then((rows) => rows[0])
    if (inviterUser) throw new Error(`Self-referral is not allowed: ${backfill.inviteeAccountID}`)

    const lite = await tx
      .select({ id: LiteTable.id })
      .from(LiteTable)
      .where(
        and(
          eq(LiteTable.workspaceID, backfill.inviteeWorkspaceID),
          eq(LiteTable.userID, inviteeUser.id),
          isNull(LiteTable.timeDeleted),
        ),
      )
      .then((rows) => rows[0])
    if (!lite) throw new Error(`Invitee Lite subscription not found: ${backfill.inviteeWorkspaceID}`)

    const existingReferral = await tx
      .select({ id: ReferralTable.id, workspaceID: ReferralTable.workspaceID })
      .from(ReferralTable)
      .where(and(eq(ReferralTable.inviteeAccountID, backfill.inviteeAccountID), isNull(ReferralTable.timeDeleted)))
      .then((rows) => rows[0])
    if (existingReferral && existingReferral.workspaceID !== backfill.inviterWorkspaceID) {
      throw new Error(`Referral already belongs to ${existingReferral.workspaceID}: ${existingReferral.id}`)
    }

    const referralID = existingReferral?.id ?? Identifier.create("referral")
    if (!existingReferral) {
      await tx.insert(ReferralTable).ignore().values({
        workspaceID: backfill.inviterWorkspaceID,
        id: referralID,
        inviteeAccountID: backfill.inviteeAccountID,
      })

      const referral = await tx
        .select({ id: ReferralTable.id })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, backfill.inviteeAccountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!referral) throw new Error(`Referral not created: ${backfill.inviteeAccountID}`)
      if (referral.id !== referralID) throw new Error(`Referral already redeemed: ${referral.id}`)
    }

    const rewardInsert = await tx
      .insert(ReferralRewardTable)
      .ignore()
      .values([
        {
          workspaceID: backfill.inviterWorkspaceID,
          referralID,
          amount: Referral.REWARD_AMOUNT,
        },
        {
          workspaceID: backfill.inviteeWorkspaceID,
          referralID,
          amount: Referral.REWARD_AMOUNT,
        },
      ])

    const rewards = await tx
      .select({ workspaceID: ReferralRewardTable.workspaceID, amount: ReferralRewardTable.amount })
      .from(ReferralRewardTable)
      .where(
        and(
          eq(ReferralRewardTable.referralID, referralID),
          inArray(ReferralRewardTable.workspaceID, [backfill.inviterWorkspaceID, backfill.inviteeWorkspaceID]),
          isNull(ReferralRewardTable.timeDeleted),
        ),
      )
    if (rewards.length !== 2) throw new Error(`Referral rewards not created: ${referralID}`)
    if (rewards.some((reward) => reward.amount !== Referral.REWARD_AMOUNT)) {
      throw new Error(`Referral reward amount mismatch: ${referralID}`)
    }

    return {
      referralID,
      createdReferral: !existingReferral,
      createdRewards: rewardInsert.rowsAffected,
      inviteeUserID: inviteeUser.id,
      liteID: lite.id,
      rewardWorkspaces: rewards.map((reward) => reward.workspaceID),
    }
  })

  console.log(`  invitee user: ${result.inviteeUserID}`)
  console.log(`  lite: ${result.liteID}`)
  console.log(`  referral: ${result.referralID} (${result.createdReferral ? "created" : "existing"})`)
  console.log(`  rewards: ${result.rewardWorkspaces.join(", ")} (${result.createdRewards} inserted)`)
}

console.log("Referral backfill complete")
