import type { APIEvent } from "@solidjs/start/server"
import { Database, eq, gte, sql, and } from "@opencode-ai/console-core/drizzle/index.js"
import { UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { getWeekBounds } from "@opencode-ai/console-core/util/date.js"

export async function GET(event: APIEvent) {
  const url = new URL(event.request.url)
  const workspaceID = url.searchParams.get("workspaceID")
  const sessionID = url.searchParams.get("sessionID")

  if (!workspaceID)
    return new Response(JSON.stringify({ error: "missing workspaceID" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })

  try {
    const now = new Date()
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0))
    const week = getWeekBounds(new Date())
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
    const minuteAgo = new Date(Date.now() - 60 * 1000)

    const totalTokensExpr = sql`COALESCE(${UsageTable.inputTokens},0)+COALESCE(${UsageTable.outputTokens},0)+COALESCE(${UsageTable.reasoningTokens},0)+COALESCE(${UsageTable.cacheReadTokens},0)+COALESCE(${UsageTable.cacheWrite5mTokens},0)+COALESCE(${UsageTable.cacheWrite1hTokens},0)`

    const workspaceFilter = eq(UsageTable.workspaceID, workspaceID)
    const sessionFilter = sessionID ? eq(UsageTable.sessionID, sessionID.substring(0, 30)) : undefined

    const [sessionAgg] = await Database.use((db) =>
      db
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(sessionID ? and(workspaceFilter, sessionFilter) : workspaceFilter),
    )

    const [dayAgg] = await Database.use((db) =>
      db
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, dayStart))),
    )

    const [weekAgg] = await Database.use((db) =>
      db
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, week.start))),
    )

    const [monthAgg] = await Database.use((db) =>
      db
        .select({ total: sql<number>`SUM(${totalTokensExpr})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, monthStart))),
    )

    const [totalAgg] = await Database.use((db) =>
      db.select({ total: sql<number>`SUM(${totalTokensExpr})` }).from(UsageTable).where(workspaceFilter),
    )

    const [minuteAgg] = await Database.use((db) =>
      db
        .select({ total: sql<number>`SUM(${UsageTable.outputTokens})` })
        .from(UsageTable)
        .where(and(workspaceFilter, gte(UsageTable.timeCreated, minuteAgo))),
    )

    const sessionTotal = (sessionAgg?.total as number) ?? 0
    const dayTotal = (dayAgg?.total as number) ?? 0
    const weekTotal = (weekAgg?.total as number) ?? 0
    const monthTotal = (monthAgg?.total as number) ?? 0
    const total = (totalAgg?.total as number) ?? 0
    const minuteOutput = (minuteAgg?.total as number) ?? 0
    const tokensPerSecond = Math.round(minuteOutput / 60)

    return new Response(
      JSON.stringify({
        tokens_session_total: sessionTotal,
        tokens_daily: dayTotal,
        tokens_weekly: weekTotal,
        tokens_monthly: monthTotal,
        tokens_total: total,
        tokens_per_second: tokensPerSecond,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }
}

