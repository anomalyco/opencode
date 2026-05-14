import { z } from "zod"
import { ulid } from "ulid"
import { and, desc, eq, isNull, sql, Database } from "./drizzle"
import { Actor } from "./actor"
import { Identifier } from "./identifier"
import { LiteTable } from "./schema/billing.sql"
import { ReferralCodeTable, ReferralRewardTable, ReferralTable } from "./schema/referral.sql"
import { UserTable } from "./schema/user.sql"
import { LiteData } from "./lite"
import { centsToMicroCents, microCentsToCents } from "./util/price"
import { getMonthlyBounds, getWeekBounds } from "./util/date"
import { fn } from "./util/fn"

export namespace Referral {
  export const REWARD_AMOUNT = centsToMicroCents(500)
  const CODE_LENGTH = 10

  function normalizeCode(code?: string) {
    return code?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH)
  }

  function generateCode() {
    return ulid().slice(-CODE_LENGTH)
  }

  export async function ensureCode(workspaceID = Actor.workspace()) {
    return Database.transaction(async (tx) => {
      const existing = await tx
        .select({ id: ReferralCodeTable.id, code: ReferralCodeTable.code })
        .from(ReferralCodeTable)
        .where(and(eq(ReferralCodeTable.workspaceID, workspaceID), isNull(ReferralCodeTable.timeDeleted)))
        .then((rows) => rows[0])
      if (existing) return existing

      for (const _ of Array.from({ length: 5 })) {
        await tx
          .insert(ReferralCodeTable)
          .values({
            workspaceID,
            id: Identifier.create("referralCode"),
            code: generateCode(),
          })
          .onDuplicateKeyUpdate({
            set: {
              code: sql`${ReferralCodeTable.code}`,
            },
          })

        const created = await tx
          .select({ id: ReferralCodeTable.id, code: ReferralCodeTable.code })
          .from(ReferralCodeTable)
          .where(and(eq(ReferralCodeTable.workspaceID, workspaceID), isNull(ReferralCodeTable.timeDeleted)))
          .then((rows) => rows[0])
        if (created) return created
      }

      throw new Error("Failed to generate referral code")
    })
  }

  export const summary = fn(z.void(), async () => {
    const workspaceID = Actor.workspace()
    const code = await ensureCode(workspaceID)
    const rows = await Database.use(async (tx) => {
      const rewards = await tx
        .select({
          id: ReferralRewardTable.id,
          source: ReferralRewardTable.source,
          amount: ReferralRewardTable.amount,
          timeCreated: ReferralRewardTable.timeCreated,
          timeApplied: ReferralRewardTable.timeApplied,
        })
        .from(ReferralRewardTable)
        .where(and(eq(ReferralRewardTable.workspaceID, workspaceID), isNull(ReferralRewardTable.timeDeleted)))
        .orderBy(desc(ReferralRewardTable.timeCreated))

      const invites = await tx
        .select({ id: ReferralTable.id })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviterWorkspaceID, workspaceID), isNull(ReferralTable.timeDeleted)))

      const lite = await tx
        .select({ id: LiteTable.id })
        .from(LiteTable)
        .where(and(eq(LiteTable.workspaceID, workspaceID), isNull(LiteTable.timeDeleted)))
        .then((result) => result[0])

      return { invites, lite, rewards }
    })

    const rewards = rows.rewards.map((reward) => ({
      ...reward,
      amount: microCentsToCents(reward.amount),
    }))

    return {
      inviteCode: code.code,
      validInviteCount: rows.invites.length,
      hasActiveGo: !!rows.lite,
      rewardAmount: microCentsToCents(REWARD_AMOUNT),
      totalEarned: rewards.reduce((total, reward) => total + reward.amount, 0),
      totalApplied: rewards
        .filter((reward) => reward.timeApplied)
        .reduce((total, reward) => total + reward.amount, 0),
      rewards,
    }
  })

  export const applyReward = fn(z.object({ rewardID: z.string() }), async (input) => {
    const workspaceID = Actor.workspace()
    const userID = Actor.userID()

    return Database.transaction(async (tx) => {
      const reward = await tx
        .select({ id: ReferralRewardTable.id, amount: ReferralRewardTable.amount, timeApplied: ReferralRewardTable.timeApplied })
        .from(ReferralRewardTable)
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, workspaceID),
            eq(ReferralRewardTable.id, input.rewardID),
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
          appliedByUserID: userID,
          timeApplied: sql`now()`,
        })
        .where(
          and(
            eq(ReferralRewardTable.workspaceID, workspaceID),
            eq(ReferralRewardTable.id, input.rewardID),
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

  export async function createFromLiteSubscription(input: {
    workspaceID: string
    userID: string
    customerID: string
    subscriptionID: string
    inviteCode?: string
  }) {
    const inviteCode = normalizeCode(input.inviteCode)
    if (!inviteCode) return { status: "missing-code" as const }

    return Database.transaction(async (tx) => {
      const code = await tx
        .select({ id: ReferralCodeTable.id, workspaceID: ReferralCodeTable.workspaceID })
        .from(ReferralCodeTable)
        .where(and(eq(ReferralCodeTable.code, inviteCode), isNull(ReferralCodeTable.timeDeleted)))
        .then((rows) => rows[0])
      if (!code) return { status: "invalid-code" as const }

      const invitee = await tx
        .select({ accountID: UserTable.accountID })
        .from(UserTable)
        .where(
          and(eq(UserTable.workspaceID, input.workspaceID), eq(UserTable.id, input.userID), isNull(UserTable.timeDeleted)),
        )
        .then((rows) => rows[0])
      if (!invitee?.accountID) return { status: "missing-account" as const }

      const existingReferral = await tx
        .select({
          id: ReferralTable.id,
          workspaceID: ReferralTable.workspaceID,
          inviterWorkspaceID: ReferralTable.inviterWorkspaceID,
          stripeSubscriptionID: ReferralTable.stripeSubscriptionID,
        })
        .from(ReferralTable)
        .where(and(eq(ReferralTable.inviteeAccountID, invitee.accountID), isNull(ReferralTable.timeDeleted)))
        .then((rows) => rows[0])
      if (existingReferral && existingReferral.stripeSubscriptionID !== input.subscriptionID)
        return { status: "already-redeemed" as const }

      if (!existingReferral) {
        const selfReferral = await tx
          .select({ id: UserTable.id })
          .from(UserTable)
          .where(
            and(
              eq(UserTable.workspaceID, code.workspaceID),
              eq(UserTable.accountID, invitee.accountID),
              isNull(UserTable.timeDeleted),
            ),
          )
          .then((rows) => rows[0])
        if (selfReferral) return { status: "self-referral" as const }

        const existingGo = await tx
          .select({ workspaceID: LiteTable.workspaceID })
          .from(LiteTable)
          .innerJoin(UserTable, and(eq(UserTable.workspaceID, LiteTable.workspaceID), eq(UserTable.id, LiteTable.userID)))
          .where(and(eq(UserTable.accountID, invitee.accountID), isNull(UserTable.timeDeleted), isNull(LiteTable.timeDeleted)))
        if (existingGo.some((row) => row.workspaceID !== input.workspaceID)) return { status: "already-subscribed" as const }

        await tx
          .insert(ReferralTable)
          .values({
            workspaceID: input.workspaceID,
            id: Identifier.create("referral"),
            inviterWorkspaceID: code.workspaceID,
            inviteeAccountID: invitee.accountID,
            inviteeUserID: input.userID,
            referralCodeID: code.id,
            stripeCustomerID: input.customerID,
            stripeSubscriptionID: input.subscriptionID,
          })
          .onDuplicateKeyUpdate({
            set: {
              stripeSubscriptionID: sql`${ReferralTable.stripeSubscriptionID}`,
            },
          })
      }

      const referral =
        existingReferral ??
        (await tx
          .select({
            id: ReferralTable.id,
            workspaceID: ReferralTable.workspaceID,
            inviterWorkspaceID: ReferralTable.inviterWorkspaceID,
          })
          .from(ReferralTable)
          .where(and(eq(ReferralTable.stripeSubscriptionID, input.subscriptionID), isNull(ReferralTable.timeDeleted)))
          .then((rows) => rows[0]))
      if (!referral) return { status: "duplicate" as const }

      await tx
        .insert(ReferralRewardTable)
        .values([
          {
            workspaceID: referral.inviterWorkspaceID,
            id: Identifier.create("referralReward"),
            referralID: referral.id,
            source: "inviter",
            amount: REWARD_AMOUNT,
          },
          {
            workspaceID: referral.workspaceID,
            id: Identifier.create("referralReward"),
            referralID: referral.id,
            source: "invitee",
            amount: REWARD_AMOUNT,
          },
        ])
        .onDuplicateKeyUpdate({
          set: {
            amount: sql`${ReferralRewardTable.amount}`,
          },
        })

      return { status: "created" as const }
    })
  }
}
