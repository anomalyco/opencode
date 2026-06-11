import { z } from "zod"
import { and, asc, eq, inArray, isNull, sql, Database } from "./drizzle"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { LiteTable, PaymentTable } from "./schema/billing.sql"
import { ReferralCodeTable, ReferralRewardTable, ReferralTable } from "./schema/referral.sql"
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
    return code
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, CODE_LENGTH)
  }

  function generateCode() {
    return ulid().slice(-CODE_LENGTH).toUpperCase()
  }

  async function ensureCode(workspaceID = Actor.workspace()) {
    return Database.use(async (db) => {
      const existing = await db
        .select({ code: ReferralCodeTable.code })
        .from(ReferralCodeTable)
        .where(eq(ReferralCodeTable.workspaceID, workspaceID))
        .then((rows) => rows[0])
      if (existing) return { code: existing.code }

      await db.insert(ReferralCodeTable).ignore().values({
        workspaceID,
        code: generateCode(),
      })

      const created = await db
        .select({ code: ReferralCodeTable.code })
        .from(ReferralCodeTable)
        .where(eq(ReferralCodeTable.workspaceID, workspaceID))
        .then((rows) => rows[0])
      if (created) return { code: created.code }

      throw new Error("Failed to generate referral code")
    })
  }

  export const summary = fn(z.void(), async () => {
    const workspaceID = Actor.workspace()
    const accountID = Actor.account()
    const code = await ensureCode(workspaceID)
    const rows = await Database.use(async (tx) => {
      const [rewards, invites, inviteeReferral, inviteeRewards] = await Promise.all([
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
          .innerJoin(
            AuthTable,
            and(eq(AuthTable.accountID, ReferralTable.inviteeAccountID), eq(AuthTable.provider, "email")),
          )
          .where(
            and(
              eq(ReferralRewardTable.workspaceID, workspaceID),
              isNull(ReferralRewardTable.timeDeleted),
              isNull(ReferralTable.timeDeleted),
            ),
          ),
        tx
          .select({ id: ReferralTable.id, inviteeEmail: AuthTable.subject, timeCreated: ReferralTable.timeCreated })
          .from(ReferralTable)
          .innerJoin(
            AuthTable,
            and(eq(AuthTable.accountID, ReferralTable.inviteeAccountID), eq(AuthTable.provider, "email")),
          )
          .where(and(eq(ReferralTable.workspaceID, workspaceID), isNull(ReferralTable.timeDeleted))),
        tx
          .select({ id: ReferralTable.id, inviterEmail: AuthTable.subject, timeCreated: ReferralTable.timeCreated })
          .from(ReferralTable)
          .leftJoin(
            UserTable,
            and(
              eq(UserTable.workspaceID, ReferralTable.workspaceID),
              eq(UserTable.role, "admin"),
              isNull(UserTable.timeDeleted),
            ),
          )
          .leftJoin(AuthTable, and(eq(AuthTable.accountID, UserTable.accountID), eq(AuthTable.provider, "email")))
          .where(and(eq(ReferralTable.inviteeAccountID, accountID), isNull(ReferralTable.timeDeleted)))
          .orderBy(asc(UserTable.timeCreated))
          .then((rows) => rows.find((row) => row.inviterEmail) ?? rows[0]),
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
      ])

      return { inviteeReferral, inviteeRewards, invites, rewards }
    })

    const rewardReferralIDs = new Set(rows.rewards.map((reward) => reward.referralID))
    const inviteeRewardReferralIDs = new Set(rows.inviteeRewards.map((reward) => reward.referralID))
    const rewards = rows.rewards.map((reward) => {
      const source = reward.workspaceID === reward.referralWorkspaceID ? ("inviter" as const) : ("invitee" as const)
      return {
        id: reward.referralID,
        source,
        status: reward.timeApplied ? ("applied" as const) : ("available" as const),
        email: source === "invitee" ? (rows.inviteeReferral?.inviterEmail ?? null) : reward.inviteeEmail,
        amount: microCentsToCents(reward.amount),
        timeCreated: reward.timeCreated,
        timeApplied: reward.timeApplied,
      }
    })
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
      ...(rows.inviteeReferral && !inviteeRewardReferralIDs.has(rows.inviteeReferral.id)
        ? [
            {
              id: `${rows.inviteeReferral.id}:invitee`,
              source: "invitee" as const,
              status: "pending" as const,
              email: rows.inviteeReferral.inviterEmail,
              amount: microCentsToCents(REWARD_AMOUNT),
              timeCreated: rows.inviteeReferral.timeCreated,
              timeApplied: null,
            },
          ]
        : []),
    ]
    const allRewards = [...pending, ...rewards].sort(
      (a, b) => new Date(b.timeCreated).getTime() - new Date(a.timeCreated).getTime(),
    )
    return {
      referralCode: code.code,
      hasReferral: allRewards.length > 0,
      rewardAmount: microCentsToCents(REWARD_AMOUNT),
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

  export async function createFromAccount(input: { accountID: string; referralCode?: string }) {
    const referralCode = normalizeCode(input.referralCode)
    if (!referralCode) return

    return Database.transaction(async (tx) => {
      const code = await tx
        .select({ workspaceID: ReferralCodeTable.workspaceID })
        .from(ReferralCodeTable)
        .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, ReferralCodeTable.workspaceID))
        .where(and(eq(ReferralCodeTable.code, referralCode), isNull(WorkspaceTable.timeDeleted)))
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

      const workspaceIDs = await tx
        .select({ workspaceID: UserTable.workspaceID })
        .from(UserTable)
        .where(and(eq(UserTable.accountID, input.accountID), isNull(UserTable.timeDeleted)))
        .then((rows) => rows.map((row) => row.workspaceID))
      if (workspaceIDs.length === 0) return

      const activeLite = await tx
        .select({ id: LiteTable.id })
        .from(LiteTable)
        .where(and(inArray(LiteTable.workspaceID, workspaceIDs), isNull(LiteTable.timeDeleted)))
        .then((rows) => rows[0])
      if (activeLite) return

      const litePayment = await tx
        .select({ id: PaymentTable.id })
        .from(PaymentTable)
        .where(
          and(
            inArray(PaymentTable.workspaceID, workspaceIDs),
            isNull(PaymentTable.timeDeleted),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${PaymentTable.enrichment}, '$.type')) = 'lite'`,
          ),
        )
        .then((rows) => rows[0])
      if (litePayment) return

      const referralID = Identifier.create("referral")
      await tx.insert(ReferralTable).ignore().values({
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

  export async function completeFromLiteSubscription(input: { workspaceID: string; userID: string }) {
    return Database.transaction(async (tx) => {
      const invitee = await tx
        .select({ accountID: UserTable.accountID })
        .from(UserTable)
        .where(
          and(
            eq(UserTable.workspaceID, input.workspaceID),
            eq(UserTable.id, input.userID),
            isNull(UserTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0])
      if (!invitee?.accountID) throw new Error("Referral invitee account missing")

      const referral = await tx
        .select({ id: ReferralTable.id, workspaceID: ReferralTable.workspaceID })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, invitee.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!referral) return

      await tx.insert(ReferralRewardTable).ignore().values({
        workspaceID: referral.workspaceID,
        referralID: referral.id,
        amount: REWARD_AMOUNT,
      })

      const existingInviteeReward = await tx
        .select({ workspaceID: ReferralRewardTable.workspaceID })
        .from(ReferralRewardTable)
        .where(
          and(
            eq(ReferralRewardTable.referralID, referral.id),
            sql`${ReferralRewardTable.workspaceID} <> ${referral.workspaceID}`,
            isNull(ReferralRewardTable.timeDeleted),
          ),
        )
        .then((rows) => rows[0])
      if (existingInviteeReward) return

      await tx.insert(ReferralRewardTable).ignore().values({
        workspaceID: input.workspaceID,
        referralID: referral.id,
        amount: REWARD_AMOUNT,
      })
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
