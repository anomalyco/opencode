import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, LiteTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"

export async function GET(input: APIEvent) {
  const token = input.request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const row = await Database.use((tx) =>
    tx
      .select({
        balance: BillingTable.balance,
        monthlyLimit: BillingTable.monthlyLimit,
        monthlyUsage: BillingTable.monthlyUsage,
        useBalance: BillingTable.lite,
        rollingUsage: LiteTable.rollingUsage,
        weeklyUsage: LiteTable.weeklyUsage,
        goMonthlyUsage: LiteTable.monthlyUsage,
        timeRollingUpdated: LiteTable.timeRollingUpdated,
        timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
        timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
        timeSubscribed: LiteTable.timeCreated,
      })
      .from(KeyTable)
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
      .leftJoin(
        LiteTable,
        and(
          eq(LiteTable.workspaceID, KeyTable.workspaceID),
          eq(LiteTable.userID, KeyTable.userID),
          isNull(LiteTable.timeDeleted),
        ),
      )
      .where(and(eq(KeyTable.key, token), isNull(KeyTable.timeDeleted)))
      .then((rows) => rows[0]),
  )
  if (!row) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const limits = row.timeSubscribed ? LiteData.getLimits() : undefined
  return Response.json({
    go:
      limits && row.timeSubscribed
        ? {
            useBalance: row.useBalance?.useBalance ?? false,
            rolling: Subscription.analyzeRollingUsage({
              limit: limits.rollingLimit,
              window: limits.rollingWindow,
              usage: row.rollingUsage ?? 0,
              timeUpdated: row.timeRollingUpdated ?? new Date(),
            }),
            weekly: Subscription.analyzeWeeklyUsage({
              limit: limits.weeklyLimit,
              usage: row.weeklyUsage ?? 0,
              timeUpdated: row.timeWeeklyUpdated ?? new Date(),
            }),
            monthly: Subscription.analyzeMonthlyUsage({
              limit: limits.monthlyLimit,
              usage: row.goMonthlyUsage ?? 0,
              timeUpdated: row.timeMonthlyUpdated ?? new Date(),
              timeSubscribed: row.timeSubscribed,
            }),
          }
        : undefined,
    zen: {
      balance: row.balance / 100_000_000,
      monthly: {
        usage: (row.monthlyUsage ?? 0) / 100_000_000,
        limit: row.monthlyLimit ?? undefined,
      },
    },
  })
}
