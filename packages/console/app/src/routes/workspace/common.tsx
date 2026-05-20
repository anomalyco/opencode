import { Resource } from "@opencode-ai/console-resource"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { action, json, query } from "@solidjs/router"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { and, Database, desc, eq, isNull, gte, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { getWeekBounds, getMonthlyBounds } from "@opencode-ai/console-core/util/date.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"

export function formatDateForTable(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }
  return date.toLocaleDateString(undefined, options).replace(",", ",")
}

export function formatDateUTC(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    timeZone: "UTC",
  }
  return date.toLocaleDateString(undefined, options)
}

export function formatBalance(amount: number) {
  const balance = ((amount ?? 0) / 100000000).toFixed(2)
  return balance === "-0.00" ? "0.00" : balance
}

export async function getLastSeenWorkspaceID() {
  "use server"
  return withActor(async () => {
    const actor = Actor.assert("account")
    return Database.use(async (tx) =>
      tx
        .select({ id: WorkspaceTable.id })
        .from(UserTable)
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        .where(
          and(
            eq(UserTable.accountID, actor.properties.accountID),
            isNull(UserTable.timeDeleted),
            isNull(WorkspaceTable.timeDeleted),
          ),
        )
        .orderBy(desc(UserTable.timeSeen))
        .limit(1)
        .then((x) => x[0]?.id),
    )
  })
}

export const querySessionInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => {
    return {
      isAdmin: Actor.userRole() === "admin",
      isBeta: Resource.App.stage === "production" ? workspaceID === "wrk_01K46JDFR0E75SG2Q8K172KF3Y" : true,
    }
  }, workspaceID)
}, "session.get")

export const createCheckoutUrl = action(
  async (workspaceID: string, amount: number, successUrl: string, cancelUrl: string) => {
    "use server"
    return json(
      await withActor(
        () =>
          Billing.generateCheckoutUrl({ amount, successUrl, cancelUrl })
            .then((data) => ({ error: undefined, data }))
            .catch((e) => ({
              error: e.message as string,
              data: undefined,
            })),
        workspaceID,
      ),
    )
  },
  "checkoutUrl",
)

export const queryBillingInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    const billing = await Billing.get()
    return {
      customerID: billing.customerID,
      paymentMethodID: billing.paymentMethodID,
      paymentMethodType: billing.paymentMethodType,
      paymentMethodLast4: billing.paymentMethodLast4,
      balance: billing.balance,
      reload: billing.reload,
      reloadAmount: billing.reloadAmount ?? Billing.RELOAD_AMOUNT,
      reloadAmountMin: Billing.RELOAD_AMOUNT_MIN,
      reloadTrigger: billing.reloadTrigger ?? Billing.RELOAD_TRIGGER,
      reloadTriggerMin: Billing.RELOAD_TRIGGER_MIN,
      monthlyLimit: billing.monthlyLimit,
      monthlyUsage: billing.monthlyUsage,
      timeMonthlyUsageUpdated: billing.timeMonthlyUsageUpdated,
      reloadError: billing.reloadError,
      timeReloadError: billing.timeReloadError,
      subscription: billing.subscription,
      subscriptionID: billing.subscriptionID,
      subscriptionPlan: billing.subscriptionPlan,
      timeSubscriptionBooked: billing.timeSubscriptionBooked,
      timeSubscriptionSelected: billing.timeSubscriptionSelected,
      lite: billing.lite,
      liteSubscriptionID: billing.liteSubscriptionID,
    }
  }, workspaceID)
}, "billing.get")

export const queryUsageMetrics = query(async (workspaceID: string, sessionID?: string) => {
  "use server"
  return withActor(async () => {
    const now = new Date()
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0))
    const week = getWeekBounds(new Date())
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
    const minuteAgo = new Date(Date.now() - 60 * 1000)

    const totalTokensExpr = sql`COALESCE(${UsageTable.inputTokens},0)+COALESCE(${UsageTable.outputTokens},0)+COALESCE(${UsageTable.reasoningTokens},0)+COALESCE(${UsageTable.cacheReadTokens},0)+COALESCE(${UsageTable.cacheWrite5mTokens},0)+COALESCE(${UsageTable.cacheWrite1hTokens},0)`

    return Database.use(async (tx) => {
      const workspaceFilter = eq(UsageTable.workspaceID, workspaceID)
      const sessionFilter = sessionID ? eq(UsageTable.sessionID, sessionID.substring(0, 30)) : undefined

      const [[sessionAgg]] = await tx
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(sessionID ? and(workspaceFilter, sessionFilter) : workspaceFilter)
        .then((r) => [r])

      const [[dayAgg]] = await tx
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, dayStart)))
        .then((r) => [r])

      const [[weekAgg]] = await tx
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, week.start)))
        .then((r) => [r])

      const [[monthAgg]] = await tx
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, monthStart)))
        .then((r) => [r])

      const [[totalAgg]] = await tx
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(workspaceFilter)
        .then((r) => [r])

      const [[minuteAgg]] = await tx
        .select({ total: sql<number>`SUM(${UsageTable.outputTokens})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, minuteAgo)))
        .then((r) => [r])

      const sessionTotal = (sessionAgg?.total as number) ?? 0
      const dayTotal = (dayAgg?.total as number) ?? 0
      const weekTotal = (weekAgg?.total as number) ?? 0
      const monthTotal = (monthAgg?.total as number) ?? 0
      const total = (totalAgg?.total as number) ?? 0
      const minuteOutput = (minuteAgg?.total as number) ?? 0
      const tokensPerSecond = Math.round(minuteOutput / 60)

      return {
        tokens_session_total: sessionTotal,
        tokens_daily: dayTotal,
        tokens_weekly: weekTotal,
        tokens_monthly: monthTotal,
        tokens_total: total,
        tokens_per_second: tokensPerSecond,
      }
    })
  }, workspaceID)
}, "usage.metrics")

