import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import {
  BillingTable,
  LiteTable,
  SubscriptionTable,
} from "@opencode-ai/console-core/schema/billing.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { microCentsToCents } from "@opencode-ai/console-core/util/price.js"
import { buildOptionsResponse } from "../../util/modelsHandler"

interface UsageWindow {
  name: string
  status: "ok" | "rate-limited"
  usagePercent: number
  resetInSec: number
  used: number
  limit: number
}

interface UsageResponse {
  plan: "free" | "lite" | "black" | "balance"
  windows: UsageWindow[]
  useBalance: boolean
}

function formatUsed(microCents: number) {
  return Math.round(microCentsToCents(microCents)) / 100
}

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export async function GET(input: APIEvent) {
  const rawApiKey = input.request.headers.get("authorization")?.split(" ")[1]
  if (!rawApiKey || rawApiKey === "public") {
    return Response.json(
      { error: "Missing API key. Set your OpenCode Go API key to view usage." },
      { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
    )
  }

  const data = await Database.use((tx) =>
    tx
      .select({
        workspaceID: KeyTable.workspaceID,
        billing: {
          balance: BillingTable.balance,
          monthlyLimit: BillingTable.monthlyLimit,
          monthlyUsage: BillingTable.monthlyUsage,
          timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
          subscription: BillingTable.subscription,
          lite: BillingTable.lite,
        },
        user: {
          id: UserTable.id,
          monthlyLimit: UserTable.monthlyLimit,
          monthlyUsage: UserTable.monthlyUsage,
          timeMonthlyUsageUpdated: UserTable.timeMonthlyUsageUpdated,
        },
        black: {
          rollingUsage: SubscriptionTable.rollingUsage,
          fixedUsage: SubscriptionTable.fixedUsage,
          timeRollingUpdated: SubscriptionTable.timeRollingUpdated,
          timeFixedUpdated: SubscriptionTable.timeFixedUpdated,
        },
        lite: {
          id: LiteTable.id,
          timeCreated: LiteTable.timeCreated,
          rollingUsage: LiteTable.rollingUsage,
          weeklyUsage: LiteTable.weeklyUsage,
          monthlyUsage: LiteTable.monthlyUsage,
          timeRollingUpdated: LiteTable.timeRollingUpdated,
          timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
          timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
        },
      })
      .from(KeyTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
      .innerJoin(
        UserTable,
        and(eq(UserTable.workspaceID, KeyTable.workspaceID), eq(UserTable.id, KeyTable.userID)),
      )
      .leftJoin(
        SubscriptionTable,
        and(
          eq(SubscriptionTable.workspaceID, KeyTable.workspaceID),
          eq(SubscriptionTable.userID, KeyTable.userID),
          isNull(SubscriptionTable.timeDeleted),
        ),
      )
      .leftJoin(
        LiteTable,
        and(
          eq(LiteTable.workspaceID, KeyTable.workspaceID),
          eq(LiteTable.userID, KeyTable.userID),
          isNull(LiteTable.timeDeleted),
        ),
      )
      .where(and(eq(KeyTable.key, rawApiKey), isNull(KeyTable.timeDeleted)))
      .then((rows) => rows[0]),
  )

  if (!data) {
    return Response.json(
      { error: "Invalid API key." },
      { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
    )
  }

  // Black subscription
  if (data.billing.subscription && data.black) {
    const plan = data.billing.subscription.plan
    const blackData = BlackData.getLimits({ plan })
    const windows: UsageWindow[] = []

    if (data.black.fixedUsage && data.black.timeFixedUpdated) {
      const result = Subscription.analyzeWeeklyUsage({
        limit: blackData.fixedLimit,
        usage: data.black.fixedUsage,
        timeUpdated: data.black.timeFixedUpdated,
      })
      windows.push({
        name: "weekly",
        status: result.status,
        usagePercent: result.usagePercent,
        resetInSec: result.resetInSec,
        used: formatUsed(data.black.fixedUsage),
        limit: blackData.fixedLimit,
      })
    }

    if (data.black.rollingUsage && data.black.timeRollingUpdated) {
      const result = Subscription.analyzeRollingUsage({
        limit: blackData.rollingLimit,
        window: blackData.rollingWindow,
        usage: data.black.rollingUsage,
        timeUpdated: data.black.timeRollingUpdated,
      })
      windows.push({
        name: `${blackData.rollingWindow}h rolling`,
        status: result.status,
        usagePercent: result.usagePercent,
        resetInSec: result.resetInSec,
        used: formatUsed(data.black.rollingUsage),
        limit: blackData.rollingLimit,
      })
    }

    return Response.json(
      {
        plan: "black",
        windows,
        useBalance: data.billing.subscription.useBalance ?? false,
      } satisfies UsageResponse,
      { headers: { "Access-Control-Allow-Origin": "*" } },
    )
  }

  // Lite (Go) subscription
  if (data.billing.lite && data.lite) {
    const liteData = LiteData.getLimits()
    const windows: UsageWindow[] = []

    if (data.lite.rollingUsage && data.lite.timeRollingUpdated) {
      const result = Subscription.analyzeRollingUsage({
        limit: liteData.rollingLimit,
        window: liteData.rollingWindow,
        usage: data.lite.rollingUsage,
        timeUpdated: data.lite.timeRollingUpdated,
      })
      windows.push({
        name: "5-hour",
        status: result.status,
        usagePercent: result.usagePercent,
        resetInSec: result.resetInSec,
        used: formatUsed(data.lite.rollingUsage),
        limit: liteData.rollingLimit,
      })
    }

    if (data.lite.weeklyUsage && data.lite.timeWeeklyUpdated) {
      const result = Subscription.analyzeWeeklyUsage({
        limit: liteData.weeklyLimit,
        usage: data.lite.weeklyUsage,
        timeUpdated: data.lite.timeWeeklyUpdated,
      })
      windows.push({
        name: "weekly",
        status: result.status,
        usagePercent: result.usagePercent,
        resetInSec: result.resetInSec,
        used: formatUsed(data.lite.weeklyUsage),
        limit: liteData.weeklyLimit,
      })
    }

    if (data.lite.monthlyUsage && data.lite.timeMonthlyUpdated) {
      const result = Subscription.analyzeMonthlyUsage({
        limit: liteData.monthlyLimit,
        usage: data.lite.monthlyUsage,
        timeUpdated: data.lite.timeMonthlyUpdated,
        timeSubscribed: data.lite.timeCreated ?? new Date(),
      })
      windows.push({
        name: "monthly",
        status: result.status,
        usagePercent: result.usagePercent,
        resetInSec: result.resetInSec,
        used: formatUsed(data.lite.monthlyUsage),
        limit: liteData.monthlyLimit,
      })
    }

    return Response.json(
      {
        plan: "lite",
        windows,
        useBalance: data.billing.lite.useBalance ?? false,
      } satisfies UsageResponse,
      { headers: { "Access-Control-Allow-Origin": "*" } },
    )
  }

  // Free tier or balance (pay-as-you-go)
  return Response.json(
    {
      plan: "free",
      windows: [],
      useBalance: false,
    } satisfies UsageResponse,
    { headers: { "Access-Control-Allow-Origin": "*" } },
  )
}
