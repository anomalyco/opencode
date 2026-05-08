import { and, Database, inArray, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelTpmRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"

export function createModelTpmLimiter(providers: { id: string; model: string; tpmLimit?: number }[]) {
  const ids = providers.filter((p) => p.tpmLimit).map((p) => `${p.id}/${p.model}`)
  if (ids.length === 0) return

  const toInterval = (date: Date) =>
    parseInt(
      date
        .toISOString()
        .replace(/[^0-9]/g, "")
        .substring(0, 12),
    )
  const now = Date.now()
  const currInterval = toInterval(new Date(now))
  const prevInterval = toInterval(new Date(now - 60_000))

  return {
    check: async () => {
      const data = await Database.use((tx) =>
        tx
          .select()
          .from(ModelTpmRateLimitTable)
          .where(
            and(
              inArray(ModelTpmRateLimitTable.id, ids),
              inArray(ModelTpmRateLimitTable.interval, [currInterval, prevInterval]),
            ),
          ),
      )

      // convert to map of model to count
      return data.reduce(
        (acc, curr) => {
          acc[curr.id] = Math.max(acc[curr.id] ?? 0, curr.count)
          return acc
        },
        {} as Record<string, number>,
      )
    },
    track: async (provider: string, model: string, usageInfo: UsageInfo) => {
      const id = `${provider}/${model}`
      if (!ids.includes(id)) return
      const usage = usageInfo.inputTokens
      if (usage <= 0) return
      await Database.use((tx) =>
        tx
          .insert(ModelTpmRateLimitTable)
          .values({ id, interval: currInterval, count: usage })
          .onDuplicateKeyUpdate({ set: { count: sql`${ModelTpmRateLimitTable.count} + ${usage}` } }),
      )
    },
  }
}
