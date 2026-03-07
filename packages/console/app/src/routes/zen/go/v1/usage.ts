import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, LiteTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"

export async function GET(input: APIEvent) {
  const apiKey = input.request.headers.get("authorization")?.split(" ")[1]

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "AuthError",
          message: "Missing API key.",
        },
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }

  const row = await Database.use((tx) =>
    tx
      .select({
        lite: BillingTable.lite,
        timeCreated: LiteTable.timeCreated,
        rollingUsage: LiteTable.rollingUsage,
        weeklyUsage: LiteTable.weeklyUsage,
        monthlyUsage: LiteTable.monthlyUsage,
        timeRollingUpdated: LiteTable.timeRollingUpdated,
        timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
        timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
      })
      .from(KeyTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
      .innerJoin(
        LiteTable,
        and(
          eq(LiteTable.workspaceID, KeyTable.workspaceID),
          eq(LiteTable.userID, KeyTable.userID),
          isNull(LiteTable.timeDeleted),
        ),
      )
      .where(and(eq(KeyTable.key, apiKey), isNull(KeyTable.timeDeleted)))
      .then((rows) => rows[0]),
  )

  if (!row) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "AuthError",
          message: "Unauthorized",
        },
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }

  const limits = LiteData.getLimits()

  return new Response(
    JSON.stringify({
      useBalance: row.lite?.useBalance ?? false,
      rollingUsage: Subscription.analyzeRollingUsage({
        limit: limits.rollingLimit,
        window: limits.rollingWindow,
        usage: row.rollingUsage ?? 0,
        timeUpdated: row.timeRollingUpdated ?? new Date(),
      }),
      weeklyUsage: Subscription.analyzeWeeklyUsage({
        limit: limits.weeklyLimit,
        usage: row.weeklyUsage ?? 0,
        timeUpdated: row.timeWeeklyUpdated ?? new Date(),
      }),
      monthlyUsage: Subscription.analyzeMonthlyUsage({
        limit: limits.monthlyLimit,
        usage: row.monthlyUsage ?? 0,
        timeUpdated: row.timeMonthlyUpdated ?? new Date(),
        timeSubscribed: row.timeCreated,
      }),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
}
