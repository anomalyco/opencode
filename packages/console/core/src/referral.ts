import { z } from "zod"
import { ulid } from "ulid"
import { and, desc, eq, isNull, sql, Database } from "./drizzle"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { LiteTable } from "./schema/billing.sql"
import { ReferralRewardTable, ReferralTable } from "./schema/referral.sql"
import { UserTable } from "./schema/user.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { LiteData } from "./lite"
import { centsToMicroCents, microCentsToCents } from "./util/price"
import { getMonthlyBounds, getWeekBounds } from "./util/date"
import { fn } from "./util/fn"

export namespace Referral {
  export const REWARD_AMOUNT = centsToMicroCents(500)
  const CODE_LENGTH = 16

  function normalizeCode(code?: string) {
    return code?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH)
  }

  function generateCode() {
    return ulid().slice(-CODE_LENGTH)
  }

  export async function ensureCode(workspaceID = Actor.workspace()) {
    return Database.transaction(async (tx) => {
      const existing = await tx
        .select({ code: WorkspaceTable.referralCode })
        .from(WorkspaceTable)
        .where(and(eq(WorkspaceTable.id, workspaceID), isNull(WorkspaceTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!existing) throw new Error("Workspace not found")
      if (existing.code) return { code: existing.code }

      for (const _ of Array.from({ length: 5 })) {
        await tx
          .update(WorkspaceTable)
          .set({ referralCode: generateCode() })
          .where(
            and(eq(WorkspaceTable.id, workspaceID), isNull(WorkspaceTable.referralCode), isNull(WorkspaceTable.timeDeleted)),
          )

        const created = await tx
          .select({ code: WorkspaceTable.referralCode })
          .from(WorkspaceTable)
          .where(and(eq(WorkspaceTable.id, workspaceID), isNull(WorkspaceTable.timeDeleted)))
          .then((rows) => rows[0])
        if (created?.code) return { code: created.code }
      }

      throw new Error("Failed to generate referral code")
    })
  }

  export const summary = fn(z.void(), async () => {
    const workspaceID = Actor.workspace()
    const accountID = Actor.account()
    const code = await ensureCode(workspaceID)
    const rows = await Database.use(async (tx) => {
      const rewards = await tx
        .select({
          referralID: ReferralRewardTable.referralID,
          workspaceID: ReferralRewardTable.workspaceID,
          referralWorkspaceID: ReferralTable.workspaceID,
          amount: ReferralRewardTable.amount,
          timeCreated: ReferralRewardTable.timeCreated,
          timeApplied: ReferralRewardTable.timeApplied,
        })
        .from(ReferralRewardTable)
        .innerJoin(ReferralTable, eq(ReferralTable.id, ReferralRewardTable.referralID))
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, workspaceID),
            isNull(ReferralRewardTable.timeDeleted),
            isNull(ReferralTable.timeDeleted),
          ),
        )
        .orderBy(desc(ReferralRewardTable.timeCreated))

      const invites = await tx
        .select({ id: ReferralTable.id, timeCreated: ReferralTable.timeCreated })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.workspaceID, workspaceID), isNull(ReferralTable.timeDeleted)))

      const inviteeReferrals = await tx
        .select({ id: ReferralTable.id, timeCreated: ReferralTable.timeCreated })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, accountID), isNull(ReferralTable.timeDeleted)))

      const inviteeRewards = await tx
        .select({ referralID: ReferralRewardTable.referralID })
        .from(ReferralRewardTable)
        .innerJoin(ReferralTable, eq(ReferralTable.id, ReferralRewardTable.referralID))
        .where(
          and(
            eq(ReferralTable.inviteeAccountID, accountID),
            isNull(ReferralRewardTable.timeDeleted),
            isNull(ReferralTable.timeDeleted),
          ),
        )

      const lite = await tx
        .select({ id: LiteTable.id })
        .from(LiteTable)
        .where(and(eq(LiteTable.workspaceID, workspaceID), isNull(LiteTable.timeDeleted)))
        .then((result) => result[0])

      return { inviteeReferrals, inviteeRewards, invites, lite, rewards }
    })

    const rewardReferralIDs = new Set(rows.rewards.map((reward) => reward.referralID))
    const inviteeRewardReferralIDs = new Set(rows.inviteeRewards.map((reward) => reward.referralID))
    const rewards = rows.rewards.map((reward) => ({
      id: reward.referralID,
      source: reward.workspaceID === reward.referralWorkspaceID ? ("inviter" as const) : ("invitee" as const),
      status: reward.timeApplied ? ("applied" as const) : ("available" as const),
      amount: microCentsToCents(reward.amount),
      timeCreated: reward.timeCreated,
      timeApplied: reward.timeApplied,
    }))
    const pending = [
      ...rows.invites
        .filter((referral) => !rewardReferralIDs.has(referral.id))
        .map((referral) => ({
          id: `${referral.id}:inviter`,
          source: "inviter" as const,
          status: "pending" as const,
          amount: microCentsToCents(REWARD_AMOUNT),
          timeCreated: referral.timeCreated,
          timeApplied: null,
        })),
      ...rows.inviteeReferrals
        .filter((referral) => !inviteeRewardReferralIDs.has(referral.id))
        .map((referral) => ({
          id: `${referral.id}:invitee`,
          source: "invitee" as const,
          status: "pending" as const,
          amount: microCentsToCents(REWARD_AMOUNT),
          timeCreated: referral.timeCreated,
          timeApplied: null,
        })),
    ].sort((a, b) => new Date(b.timeCreated).getTime() - new Date(a.timeCreated).getTime())
    return {
      inviteCode: code.code,
      validInviteCount: rows.invites.length,
      hasActiveGo: !!rows.lite,
      rewardAmount: microCentsToCents(REWARD_AMOUNT),
      totalEarned: rewards.reduce((total, reward) => total + reward.amount, 0),
      totalApplied: rewards
        .filter((reward) => reward.timeApplied)
        .reduce((total, reward) => total + reward.amount, 0),
      rewards: [...pending, ...rewards].sort(
        (a, b) => new Date(b.timeCreated).getTime() - new Date(a.timeCreated).getTime(),
      ),
    }
  })

  export const applyReward = fn(z.object({ referralID: z.string() }), async (input) => {
    const workspaceID = Actor.workspace()

    return Database.transaction(async (tx) => {
      const reward = await tx
        .select({ amount: ReferralRewardTable.amount, timeApplied: ReferralRewardTable.timeApplied })
        .from(ReferralRewardTable)
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, workspaceID),
            eq(ReferralRewardTable.referralID, input.referralID),
            isNull(ReferralRewardTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0])
      if (!reward) throw new Error("Referral reward not found")
      if (reward.timeApplied) return { applied: false }

      const lite = await tx
        .select({ id: LiteTable.id, timeCreated: LiteTable.timeCreated })
        .from(LiteTable)
        .where(and(eq(LiteTable.workspaceID, workspaceID), isNull(LiteTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!lite) throw new Error("Subscribe to Go before applying referral rewards")

      const update = await tx
        .update(ReferralRewardTable)
        .set({
          timeApplied: sql`now()`,
        })
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, workspaceID),
            eq(ReferralRewardTable.referralID, input.referralID),
            isNull(ReferralRewardTable.timeApplied),
            isNull(ReferralRewardTable.timeDeleted),
          ),
        )
      if (update.rowsAffected === 0) return { applied: false }

      const week = getWeekBounds(new Date())
      const month = getMonthlyBounds(new Date(), lite.timeCreated)
      const rollingWindowSeconds = LiteData.getLimits().rollingWindow * 3600
      await tx
        .update(LiteTable)
        .set({
          monthlyUsage: sql`
            CASE
              WHEN ${LiteTable.timeMonthlyUpdated} >= ${month.start} THEN GREATEST(0, COALESCE(${LiteTable.monthlyUsage}, 0) - ${reward.amount})
              ELSE ${LiteTable.monthlyUsage}
            END
          `,
          weeklyUsage: sql`
            CASE
              WHEN ${LiteTable.timeWeeklyUpdated} >= ${week.start} THEN GREATEST(0, COALESCE(${LiteTable.weeklyUsage}, 0) - ${reward.amount})
              ELSE ${LiteTable.weeklyUsage}
            END
          `,
          rollingUsage: sql`
            CASE
              WHEN UNIX_TIMESTAMP(${LiteTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN GREATEST(0, COALESCE(${LiteTable.rollingUsage}, 0) - ${reward.amount})
              ELSE ${LiteTable.rollingUsage}
            END
          `,
        })
        .where(and(eq(LiteTable.workspaceID, workspaceID), isNull(LiteTable.timeDeleted)))

      return { applied: true, amount: microCentsToCents(reward.amount) }
    })
  })

  export async function createFromAccount(input: {
    accountID: string
    inviteCode?: string
  }) {
    const inviteCode = normalizeCode(input.inviteCode)
    if (!inviteCode) return { status: "missing-code" as const }

    return Database.transaction(async (tx) => {
      const code = await tx
        .select({ workspaceID: WorkspaceTable.id })
        .from(WorkspaceTable)
        .where(and(eq(WorkspaceTable.referralCode, inviteCode), isNull(WorkspaceTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!code) return { status: "invalid-code" as const }

      const existingReferral = await tx
        .select({ id: ReferralTable.id })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, input.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (existingReferral) return { status: "already-redeemed" as const }

      const selfReferral = await tx
        .select({ id: UserTable.id })
        .from(UserTable)
        .where(
          and(
            eq(UserTable.workspaceID, code.workspaceID),
            eq(UserTable.accountID, input.accountID),
            isNull(UserTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0])
      if (selfReferral) return { status: "self-referral" as const }

      const referralID = Identifier.create("referral")
      await tx
        .insert(ReferralTable)
        .values({
          workspaceID: code.workspaceID,
          id: referralID,
          inviteeAccountID: input.accountID,
        })
        .onDuplicateKeyUpdate({
          set: {
            inviteeAccountID: sql`${ReferralTable.inviteeAccountID}`,
          },
        })

      const referral = await tx
        .select({ id: ReferralTable.id, workspaceID: ReferralTable.workspaceID })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, input.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!referral) return { status: "duplicate" as const }
      if (referral.id !== referralID) return { status: "already-redeemed" as const }

      return { status: "created" as const }
    })
  }

  export async function completeFromLiteSubscription(input: {
    workspaceID: string
    userID: string
  }) {
    return Database.transaction(async (tx) => {
      const invitee = await tx
        .select({ accountID: UserTable.accountID })
        .from(UserTable)
        .where(
          and(eq(UserTable.workspaceID, input.workspaceID), eq(UserTable.id, input.userID), isNull(UserTable.timeDeleted)),
        )
        .then((rows) => rows[0])
      if (!invitee?.accountID) return { status: "missing-account" as const }

      const referral = await tx
        .select({ id: ReferralTable.id, workspaceID: ReferralTable.workspaceID })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, invitee.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!referral) return { status: "missing-referral" as const }

      const existingRewards = await tx
        .select({ referralID: ReferralRewardTable.referralID })
        .from(ReferralRewardTable)
        .where(and(eq(ReferralRewardTable.referralID, referral.id), isNull(ReferralRewardTable.timeDeleted)))
      if (existingRewards.length > 0) return { status: "already-completed" as const }

      await tx
        .insert(ReferralRewardTable)
        .values([
          {
            workspaceID: referral.workspaceID,
            referralID: referral.id,
            amount: REWARD_AMOUNT,
          },
          {
            workspaceID: input.workspaceID,
            referralID: referral.id,
            amount: REWARD_AMOUNT,
          },
        ])

      return { status: "created" as const }
    })
  }
}
