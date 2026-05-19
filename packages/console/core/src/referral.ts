import { z } from "zod"
import { and, desc, eq, isNull, sql, Database } from "./drizzle"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { LiteTable } from "./schema/billing.sql"
import { ReferralRewardTable, ReferralTable } from "./schema/referral.sql"
import { AuthTable } from "./schema/auth.sql"
import { UserTable } from "./schema/user.sql"
import { WorkspaceTable } from "./schema/workspace.sql"
import { centsToMicroCents, microCentsToCents } from "./util/price"
import { fn } from "./util/fn"
import { Billing } from "./billing"
import { LiteData } from "./lite"
import { Subscription } from "./subscription"
import { ulid } from "ulid"

export namespace Referral {
  export const REWARD_AMOUNT = centsToMicroCents(500)
  export const CODE_LENGTH = 10

  export function normalizeCode(code?: string | null) {
    return code?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH)
  }

  function generateCode() {
    return ulid().slice(-CODE_LENGTH)
  }

  async function ensureCode(workspaceID = Actor.workspace()) {
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
      const [rewards, invites, inviteeReferrals, inviteeRewards, lite] = await Promise.all([
        tx
          .select({
            referralID: ReferralRewardTable.referralID,
            workspaceID: ReferralRewardTable.workspaceID,
            referralWorkspaceID: ReferralTable.workspaceID,
            inviteeEmail: AuthTable.subject,
            amount: ReferralRewardTable.amount,
            timeCreated: ReferralRewardTable.timeCreated,
            timeApplied: ReferralRewardTable.timeApplied,
          })
          .from(ReferralRewardTable)
          .innerJoin(ReferralTable, eq(ReferralTable.id, ReferralRewardTable.referralID))
          .innerJoin(AuthTable, and(eq(AuthTable.accountID, ReferralTable.inviteeAccountID), eq(AuthTable.provider, "email")))
          .where(
            and(
              eq(ReferralRewardTable.workspaceID, workspaceID),
              isNull(ReferralRewardTable.timeDeleted),
              isNull(ReferralTable.timeDeleted),
            ),
          )
          .orderBy(desc(ReferralRewardTable.timeCreated)),
        tx
          .select({ id: ReferralTable.id, inviteeEmail: AuthTable.subject, timeCreated: ReferralTable.timeCreated })
          .from(ReferralTable)
          .innerJoin(AuthTable, and(eq(AuthTable.accountID, ReferralTable.inviteeAccountID), eq(AuthTable.provider, "email")))
          .where(and(eq(ReferralTable.workspaceID, workspaceID), isNull(ReferralTable.timeDeleted))),
        tx
          .select({ id: ReferralTable.id, inviteeEmail: AuthTable.subject, timeCreated: ReferralTable.timeCreated })
          .from(ReferralTable)
          .innerJoin(AuthTable, and(eq(AuthTable.accountID, ReferralTable.inviteeAccountID), eq(AuthTable.provider, "email")))
          .where(and(eq(ReferralTable.inviteeAccountID, accountID), isNull(ReferralTable.timeDeleted))),
        tx
          .select({ referralID: ReferralRewardTable.referralID })
          .from(ReferralRewardTable)
          .innerJoin(ReferralTable, eq(ReferralTable.id, ReferralRewardTable.referralID))
          .where(
            and(
              eq(ReferralTable.inviteeAccountID, accountID),
              isNull(ReferralRewardTable.timeDeleted),
              isNull(ReferralTable.timeDeleted),
            ),
          ),
        tx
          .select({ id: LiteTable.id })
          .from(LiteTable)
          .where(and(eq(LiteTable.workspaceID, workspaceID), isNull(LiteTable.timeDeleted)))
          .then((result) => result[0]),
      ])

      return { inviteeReferrals, inviteeRewards, invites, lite, rewards }
    })

    const rewardReferralIDs = new Set(rows.rewards.map((reward) => reward.referralID))
    const inviteeRewardReferralIDs = new Set(rows.inviteeRewards.map((reward) => reward.referralID))
    const rewards = rows.rewards.map((reward) => ({
      id: reward.referralID,
      source: reward.workspaceID === reward.referralWorkspaceID ? ("inviter" as const) : ("invitee" as const),
      status: reward.timeApplied ? ("applied" as const) : ("available" as const),
      email: reward.inviteeEmail,
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
          email: referral.inviteeEmail,
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
          email: referral.inviteeEmail,
          amount: microCentsToCents(REWARD_AMOUNT),
          timeCreated: referral.timeCreated,
          timeApplied: null,
        })),
    ]
    const allRewards = [...pending, ...rewards].sort(
      (a, b) => new Date(b.timeCreated).getTime() - new Date(a.timeCreated).getTime(),
    )
    return {
      referralCode: code.code,
      inviteCount: allRewards.length,
      hasActiveGo: !!rows.lite,
      rewardAmount: microCentsToCents(REWARD_AMOUNT),
      totalEarned: rewards.reduce((total, reward) => total + reward.amount, 0),
      totalApplied: rewards
        .filter((reward) => reward.timeApplied)
        .reduce((total, reward) => total + reward.amount, 0),
      rewards: allRewards,
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
      if (reward.timeApplied) throw new Error("Referral reward already applied")

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
      if (update.rowsAffected === 0) throw new Error("Referral reward already applied")

      await Billing.subtractLiteUsage(workspaceID, reward.amount)

      return { amount: microCentsToCents(reward.amount) }
    })
  })

  export const usagePreview = fn(z.object({ referralID: z.string() }), async (input) => {
    const row = await Database.use((tx) =>
      tx
        .select({
          rewardAmount: ReferralRewardTable.amount,
          rollingUsage: LiteTable.rollingUsage,
          weeklyUsage: LiteTable.weeklyUsage,
          monthlyUsage: LiteTable.monthlyUsage,
          timeRollingUpdated: LiteTable.timeRollingUpdated,
          timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
          timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
          timeCreated: LiteTable.timeCreated,
        })
        .from(ReferralRewardTable)
        .innerJoin(LiteTable, eq(LiteTable.workspaceID, ReferralRewardTable.workspaceID))
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, Actor.workspace()),
            eq(ReferralRewardTable.referralID, input.referralID),
            isNull(ReferralRewardTable.timeApplied),
            isNull(ReferralRewardTable.timeDeleted),
            isNull(LiteTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0]),
    )
    if (!row) return null

    const limits = LiteData.getLimits()
    return {
      rollingUsage: usagePreviewItem(
        Subscription.analyzeRollingUsage({
          limit: limits.rollingLimit,
          window: limits.rollingWindow,
          usage: row.rollingUsage ?? 0,
          timeUpdated: row.timeRollingUpdated ?? new Date(),
        }),
        Subscription.analyzeRollingUsage({
          limit: limits.rollingLimit,
          window: limits.rollingWindow,
          usage: Math.max(0, (row.rollingUsage ?? 0) - row.rewardAmount),
          timeUpdated: row.timeRollingUpdated ?? new Date(),
        }),
      ),
      weeklyUsage: usagePreviewItem(
        Subscription.analyzeWeeklyUsage({
          limit: limits.weeklyLimit,
          usage: row.weeklyUsage ?? 0,
          timeUpdated: row.timeWeeklyUpdated ?? new Date(),
        }),
        Subscription.analyzeWeeklyUsage({
          limit: limits.weeklyLimit,
          usage: Math.max(0, (row.weeklyUsage ?? 0) - row.rewardAmount),
          timeUpdated: row.timeWeeklyUpdated ?? new Date(),
        }),
      ),
      monthlyUsage: usagePreviewItem(
        Subscription.analyzeMonthlyUsage({
          limit: limits.monthlyLimit,
          usage: row.monthlyUsage ?? 0,
          timeUpdated: row.timeMonthlyUpdated ?? new Date(),
          timeSubscribed: row.timeCreated,
        }),
        Subscription.analyzeMonthlyUsage({
          limit: limits.monthlyLimit,
          usage: Math.max(0, (row.monthlyUsage ?? 0) - row.rewardAmount),
          timeUpdated: row.timeMonthlyUpdated ?? new Date(),
          timeSubscribed: row.timeCreated,
        }),
      ),
    }
  })

  export async function createFromAccount(input: {
    accountID: string
    referralCode?: string
  }) {
    const referralCode = normalizeCode(input.referralCode)
    if (!referralCode) return

    return Database.transaction(async (tx) => {
      const code = await tx
        .select({ workspaceID: WorkspaceTable.id })
        .from(WorkspaceTable)
        .where(and(eq(WorkspaceTable.referralCode, referralCode), isNull(WorkspaceTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!code) throw new Error("Referral code invalid")

      const existingReferral = await tx
        .select({ id: ReferralTable.id })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, input.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (existingReferral) throw new Error("Referral already redeemed")

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
      if (selfReferral) throw new Error("Self-referral is not allowed")

      const referralID = Identifier.create("referral")
      await tx
        .insert(ReferralTable)
        .ignore()
        .values({
          workspaceID: code.workspaceID,
          id: referralID,
          inviteeAccountID: input.accountID,
        })

      const referral = await tx
        .select({ id: ReferralTable.id, workspaceID: ReferralTable.workspaceID })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, input.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!referral) throw new Error("Referral not created")
      if (referral.id !== referralID) throw new Error("Referral already redeemed")
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
      if (!invitee?.accountID) throw new Error("Referral invitee account missing")

      const referral = await tx
        .select({ id: ReferralTable.id, workspaceID: ReferralTable.workspaceID })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, invitee.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!referral) throw new Error("Referral not found")

      const result = await tx
        .insert(ReferralRewardTable)
        .ignore()
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

      if (result.rowsAffected === 0) throw new Error("Referral already completed")
    })
  }

  function usagePreviewItem(
    before: { usagePercent: number; resetInSec: number },
    after: { usagePercent: number; resetInSec: number },
  ) {
    return {
      beforePercent: before.usagePercent,
      afterPercent: after.usagePercent,
      resetInSec: after.resetInSec,
    }
  }
}
