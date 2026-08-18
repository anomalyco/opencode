"use server"

import { Database, and, eq, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { AuthTable } from "@opencode-ai/console-core/schema/auth.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import {
  BillingTable,
  PaymentTable,
  SubscriptionTable,
  BlackPlans,
  UsageTable,
  LiteTable,
} from "@opencode-ai/console-core/schema/billing.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { getWeekBounds } from "@opencode-ai/console-core/util/date.js"

export type LookupResult = {
  identifier: string
  auth?: Record<string, unknown>[]
  accountWorkspaces?: Record<string, unknown>[]
  workspaces: WorkspaceSection[]
}

export type WorkspaceSection = {
  workspaceID: string
  title: string
  users: Record<string, unknown>[]
  billing: Record<string, unknown> | null
  go: Record<string, unknown>[]
  payments: Record<string, unknown>[]
  usage: Record<string, unknown>[]
  disabledModels: Record<string, unknown>[]
}

export async function lookup(identifier: string): Promise<LookupResult> {
  if (!identifier) throw new Error("Identifier is required")

  if (identifier.startsWith("wrk_")) {
    const workspace = await loadWorkspace(identifier)
    return { identifier, workspaces: [workspace] }
  }

  if (identifier.startsWith("key_")) {
    const key = await Database.use((tx) =>
      tx
        .select()
        .from(KeyTable)
        .where(eq(KeyTable.id, identifier))
        .then((rows) => rows[0]),
    )
    if (!key) throw new Error("API key not found")
    const workspace = await loadWorkspace(key.workspaceID)
    return { identifier, workspaces: [workspace] }
  }

  if (identifier.startsWith("sk-")) {
    const key = await Database.use((tx) =>
      tx
        .select()
        .from(KeyTable)
        .where(eq(KeyTable.key, identifier))
        .then((rows) => rows[0]),
    )
    if (!key) throw new Error("API key not found")
    const workspace = await loadWorkspace(key.workspaceID)
    return { identifier, workspaces: [workspace] }
  }

  // Treat as email
  const authData = await Database.use((tx) => tx.select().from(AuthTable).where(eq(AuthTable.subject, identifier)))
  if (authData.length === 0) throw new Error("Email not found")

  const accountID = authData[0].accountID
  const auth = await Database.use((tx) => tx.select().from(AuthTable).where(eq(AuthTable.accountID, accountID)))

  const accountWorkspaces = await Database.use((tx) =>
    tx
      .select({
        userID: UserTable.id,
        workspaceID: UserTable.workspaceID,
        workspaceName: WorkspaceTable.name,
        balance: BillingTable.balance,
        role: UserTable.role,
        black: SubscriptionTable.timeCreated,
        lite: LiteTable.timeCreated,
      })
      .from(UserTable)
      .rightJoin(WorkspaceTable, eq(WorkspaceTable.id, UserTable.workspaceID))
      .leftJoin(BillingTable, eq(BillingTable.workspaceID, WorkspaceTable.id))
      .leftJoin(SubscriptionTable, eq(SubscriptionTable.userID, UserTable.id))
      .leftJoin(LiteTable, eq(LiteTable.userID, UserTable.id))
      .where(eq(UserTable.accountID, accountID))
      .then((rows) =>
        rows.map((row) => ({
          workspaceName: row.workspaceID
            ? { __link: `#workspace-${row.workspaceID}`, label: row.workspaceName }
            : row.workspaceName,
          userID: row.userID,
          workspaceID: row.workspaceID,
          balance: formatMicroCents(row.balance) ?? "$0.00",
          role: row.role,
          black: formatDate(row.black),
          lite: formatDate(row.lite),
        })),
      ),
  )

  const workspaces: WorkspaceSection[] = []
  for (const w of accountWorkspaces) {
    if (!w.workspaceID) continue
    workspaces.push(await loadWorkspace(w.workspaceID))
  }

  return {
    identifier,
    auth: auth.map((row) => ({
      provider: row.provider,
      subject: row.subject,
      accountID: row.accountID,
    })),
    accountWorkspaces,
    workspaces,
  }
}

async function loadWorkspace(workspaceID: string): Promise<WorkspaceSection> {
  const workspace = await Database.use((tx) =>
    tx
      .select()
      .from(WorkspaceTable)
      .where(eq(WorkspaceTable.id, workspaceID))
      .then((rows) => rows[0]),
  )
  if (!workspace) throw new Error(`Workspace ${workspaceID} not found`)

  const users = await Database.use((tx) =>
    tx
      .select({
        authEmail: AuthTable.subject,
        inviteEmail: UserTable.email,
        role: UserTable.role,
        timeSeen: UserTable.timeSeen,
        monthlyLimit: UserTable.monthlyLimit,
        monthlyUsage: UserTable.monthlyUsage,
        timeDeleted: UserTable.timeDeleted,
        fixedUsage: SubscriptionTable.fixedUsage,
        rollingUsage: SubscriptionTable.rollingUsage,
        timeFixedUpdated: SubscriptionTable.timeFixedUpdated,
        timeRollingUpdated: SubscriptionTable.timeRollingUpdated,
        timeSubscriptionCreated: SubscriptionTable.timeCreated,
        subscription: BillingTable.subscription,
      })
      .from(UserTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, workspace.id))
      .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
      .leftJoin(SubscriptionTable, eq(SubscriptionTable.userID, UserTable.id))
      .where(eq(UserTable.workspaceID, workspace.id))
      .then((rows) =>
        rows.map((row) => {
          const subStatus = getSubscriptionStatus(row)
          return {
            email: (row.timeDeleted ? "[deleted] " : "") + (row.authEmail ?? row.inviteEmail),
            role: row.role,
            timeSeen: formatDate(row.timeSeen),
            monthly: formatMonthlyUsage(row.monthlyUsage, row.monthlyLimit),
            subscribed: formatDate(row.timeSubscriptionCreated),
            subWeekly: subStatus.weekly,
            subRolling: subStatus.rolling,
            rateLimited: subStatus.rateLimited,
            retryIn: subStatus.retryIn,
          }
        }),
      ),
  )

  const billing = await Database.use((tx) =>
    tx
      .select({
        balance: BillingTable.balance,
        customerID: BillingTable.customerID,
        reload: BillingTable.reload,
        blackSubscriptionID: BillingTable.subscriptionID,
        blackSubscription: {
          plan: BillingTable.subscriptionPlan,
          booked: BillingTable.timeSubscriptionBooked,
          enrichment: BillingTable.subscription,
        },
        timeBlackSubscriptionSelected: BillingTable.timeSubscriptionSelected,
        liteSubscriptionID: BillingTable.liteSubscriptionID,
      })
      .from(BillingTable)
      .where(eq(BillingTable.workspaceID, workspace.id))
      .then(
        (rows) =>
          rows.map((row) => ({
            balance: `$${(row.balance / 100000000).toFixed(2)}`,
            reload: row.reload ? "yes" : "no",
            customerID: row.customerID,
            GO: row.liteSubscriptionID,
            Black: row.blackSubscriptionID
              ? [
                  `Black ${row.blackSubscription.enrichment!.plan}`,
                  row.blackSubscription.enrichment!.seats > 1
                    ? `X ${row.blackSubscription.enrichment!.seats} seats`
                    : "",
                  row.blackSubscription.enrichment!.coupon
                    ? `(coupon: ${row.blackSubscription.enrichment!.coupon})`
                    : "",
                  `(ref: ${row.blackSubscriptionID})`,
                ].join(" ")
              : row.blackSubscription.booked
                ? `Waitlist ${row.blackSubscription.plan} plan${row.timeBlackSubscriptionSelected ? " (selected)" : ""}`
                : undefined,
          }))[0] ?? null,
      ),
  )

  const liteLimits = LiteData.getLimits()
  const go = await Database.use((tx) =>
    tx
      .select({
        userID: LiteTable.userID,
        userEmail: UserTable.email,
        authEmail: AuthTable.subject,
        rollingUsage: LiteTable.rollingUsage,
        weeklyUsage: LiteTable.weeklyUsage,
        monthlyUsage: LiteTable.monthlyUsage,
        timeRollingUpdated: LiteTable.timeRollingUpdated,
        timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
        timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
        timeCreated: LiteTable.timeCreated,
        useBalance: BillingTable.lite,
      })
      .from(LiteTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, LiteTable.workspaceID))
      .leftJoin(UserTable, eq(UserTable.id, LiteTable.userID))
      .leftJoin(AuthTable, and(eq(UserTable.accountID, AuthTable.accountID), eq(AuthTable.provider, "email")))
      .where(and(eq(LiteTable.workspaceID, workspace.id), isNull(LiteTable.timeDeleted)))
      .then((rows) =>
        rows.map((row) => {
          const rolling = Subscription.analyzeRollingUsage({
            limit: liteLimits.rollingLimit,
            window: liteLimits.rollingWindow,
            usage: row.rollingUsage ?? 0,
            timeUpdated: row.timeRollingUpdated ?? new Date(),
          })
          const weekly = Subscription.analyzeWeeklyUsage({
            limit: liteLimits.weeklyLimit,
            usage: row.weeklyUsage ?? 0,
            timeUpdated: row.timeWeeklyUpdated ?? new Date(),
          })
          const monthly = Subscription.analyzeMonthlyUsage({
            limit: liteLimits.monthlyLimit,
            usage: row.monthlyUsage ?? 0,
            timeUpdated: row.timeMonthlyUpdated ?? new Date(),
            timeSubscribed: row.timeCreated,
          })
          return {
            email: row.authEmail ?? row.userEmail ?? row.userID,
            subscribed: formatDate(row.timeCreated),
            useBalance: row.useBalance?.useBalance ? "yes" : "no",
            rolling: formatLiteUsage(rolling),
            weekly: formatLiteUsage(weekly),
            monthly: formatLiteUsage(monthly),
          }
        }),
      ),
  )

  const payments = await Database.use((tx) =>
    tx
      .select({
        amount: PaymentTable.amount,
        paymentID: PaymentTable.paymentID,
        invoiceID: PaymentTable.invoiceID,
        customerID: PaymentTable.customerID,
        timeCreated: PaymentTable.timeCreated,
        timeRefunded: PaymentTable.timeRefunded,
      })
      .from(PaymentTable)
      .where(eq(PaymentTable.workspaceID, workspace.id))
      .orderBy(sql`${PaymentTable.timeCreated} DESC`)
      .limit(100)
      .then((rows) =>
        rows.map((row) => ({
          amount: `$${(row.amount / 100000000).toFixed(2)}`,
          paymentID: row.paymentID
            ? `https://dashboard.stripe.com/acct_1RszBH2StuRr0lbX/payments/${row.paymentID}`
            : null,
          invoiceID: row.invoiceID,
          customerID: row.customerID,
          timeCreated: formatDate(row.timeCreated),
          timeRefunded: formatDate(row.timeRefunded),
        })),
      ),
  )

  const planExpr = sql`JSON_UNQUOTE(JSON_EXTRACT(${UsageTable.enrichment}, '$.plan'))`
  const usage = await Database.use((tx) =>
    tx
      .select({
        date: sql<string>`DATE(${UsageTable.timeCreated})`.as("date"),
        freeRequests: sql<number>`SUM(CASE WHEN ${UsageTable.cost} = 0 THEN 1 ELSE 0 END)`.as("free_requests"),
        goRequests: sql<number>`SUM(CASE WHEN ${planExpr} = 'lite' THEN 1 ELSE 0 END)`.as("go_requests"),
        goCost: sql<number>`SUM(CASE WHEN ${planExpr} = 'lite' THEN ${UsageTable.cost} ELSE 0 END)`.as("go_cost"),
        apiRequests: sql<number>`SUM(CASE WHEN ${planExpr} IS NULL AND ${UsageTable.cost} > 0 THEN 1 ELSE 0 END)`.as(
          "api_requests",
        ),
        apiCost:
          sql<number>`SUM(CASE WHEN ${planExpr} IS NULL AND ${UsageTable.cost} > 0 THEN ${UsageTable.cost} ELSE 0 END)`.as(
            "api_cost",
          ),
      })
      .from(UsageTable)
      .where(
        and(
          eq(UsageTable.workspaceID, workspace.id),
          sql`${UsageTable.timeCreated} >= DATE_SUB(NOW(), INTERVAL 28 DAY)`,
        ),
      )
      .groupBy(sql`DATE(${UsageTable.timeCreated})`)
      .orderBy(sql`DATE(${UsageTable.timeCreated}) DESC`)
      .then((rows) => {
        const totals = rows.reduce(
          (acc, r) => ({
            freeRequests: acc.freeRequests + Number(r.freeRequests),
            goRequests: acc.goRequests + Number(r.goRequests),
            goCost: acc.goCost + Number(r.goCost),
            apiRequests: acc.apiRequests + Number(r.apiRequests),
            apiCost: acc.apiCost + Number(r.apiCost),
          }),
          { freeRequests: 0, goRequests: 0, goCost: 0, apiRequests: 0, apiCost: 0 },
        )
        const mapped: Record<string, unknown>[] = rows.map((row) => ({
          date: row.date,
          freeRequests: Number(row.freeRequests),
          goRequests: Number(row.goRequests),
          goCost: formatMicroCents(Number(row.goCost)) ?? "$0.00",
          apiRequests: Number(row.apiRequests),
          apiCost: formatMicroCents(Number(row.apiCost)) ?? "$0.00",
        }))
        if (mapped.length > 0) {
          mapped.push({
            date: "TOTAL",
            freeRequests: totals.freeRequests,
            goRequests: totals.goRequests,
            goCost: formatMicroCents(totals.goCost) ?? "$0.00",
            apiRequests: totals.apiRequests,
            apiCost: formatMicroCents(totals.apiCost) ?? "$0.00",
          })
        }
        return mapped
      }),
  )

  const disabledModels = await Database.use((tx) =>
    tx
      .select({
        model: ModelTable.model,
        timeCreated: ModelTable.timeCreated,
      })
      .from(ModelTable)
      .where(eq(ModelTable.workspaceID, workspace.id))
      .orderBy(sql`${ModelTable.timeCreated} DESC`)
      .then((rows) =>
        rows.map((row) => ({
          model: row.model,
          timeCreated: formatDate(row.timeCreated),
        })),
      ),
  )

  return {
    workspaceID: workspace.id,
    title: `Workspace "${workspace.name}" (${workspace.id})`,
    users,
    billing,
    go,
    payments,
    usage,
    disabledModels,
  }
}

function formatLiteUsage(usage: { status: "ok" | "rate-limited"; usagePercent: number; resetInSec: number }) {
  const reset = formatResetTime(usage.resetInSec)
  const status = usage.status === "rate-limited" ? " [limited]" : ""
  return `${usage.usagePercent}% (resets in ${reset})${status}`
}

function formatResetTime(seconds: number) {
  if (seconds <= 0) return "now"
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) {
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return `${minutes}m`
}

function formatMicroCents(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  return `$${(value / 100000000).toFixed(2)}`
}

function formatDate(value: Date | null | undefined) {
  if (!value) return null
  return value.toISOString().split("T")[0]
}

function formatMonthlyUsage(usage: number | null | undefined, limit: number | null | undefined) {
  const usageText = formatMicroCents(usage) ?? "$0.00"
  if (limit === null || limit === undefined) return `${usageText} / no limit`
  return `${usageText} / $${limit.toFixed(2)}`
}

function formatRetryTime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `${days} day${days > 1 ? "s" : ""}`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.ceil((seconds % 3600) / 60)
  if (hours >= 1) return `${hours}hr ${minutes}min`
  return `${minutes}min`
}

function getSubscriptionStatus(row: {
  subscription: {
    plan: (typeof BlackPlans)[number]
  } | null
  timeSubscriptionCreated: Date | null
  fixedUsage: number | null
  rollingUsage: number | null
  timeFixedUpdated: Date | null
  timeRollingUpdated: Date | null
}) {
  if (!row.timeSubscriptionCreated || !row.subscription) {
    return { weekly: null, rolling: null, rateLimited: null, retryIn: null }
  }

  const black = BlackData.getLimits({ plan: row.subscription.plan })
  const now = new Date()
  const week = getWeekBounds(now)

  const fixedLimit = black.fixedLimit ? centsToMicroCents(black.fixedLimit * 100) : null
  const rollingLimit = black.rollingLimit ? centsToMicroCents(black.rollingLimit * 100) : null
  const rollingWindowMs = (black.rollingWindow ?? 5) * 3600 * 1000

  const currentWeekly =
    row.fixedUsage && row.timeFixedUpdated && row.timeFixedUpdated >= week.start ? row.fixedUsage : 0

  const windowStart = new Date(now.getTime() - rollingWindowMs)
  const currentRolling =
    row.rollingUsage && row.timeRollingUpdated && row.timeRollingUpdated >= windowStart ? row.rollingUsage : 0

  const isWeeklyLimited = fixedLimit !== null && currentWeekly >= fixedLimit
  const isRollingLimited = rollingLimit !== null && currentRolling >= rollingLimit

  const retryIn = isWeeklyLimited
    ? formatRetryTime(Math.ceil((week.end.getTime() - now.getTime()) / 1000))
    : isRollingLimited && row.timeRollingUpdated
      ? formatRetryTime(Math.ceil((row.timeRollingUpdated.getTime() + rollingWindowMs - now.getTime()) / 1000))
      : null

  return {
    weekly: fixedLimit !== null ? `${formatMicroCents(currentWeekly)} / $${black.fixedLimit}` : null,
    rolling: rollingLimit !== null ? `${formatMicroCents(currentRolling)} / $${black.rollingLimit}` : null,
    rateLimited: isWeeklyLimited || isRollingLimited ? "yes" : "no",
    retryIn,
  }
}
