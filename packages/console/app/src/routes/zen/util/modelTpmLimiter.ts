import { and, Database, eq, inArray, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelTpmRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"

export function createModelTpmLimiter(providers: { id: string; model: string; tpmLimit?: number }[]) {
  const ids = providers.filter((p) => p.tpmLimit).map((p) => `${p.id}/${p.model}`)
  if (ids.length === 0) return

  const yyyyMMddHHmm = parseInt(
    new Date(Date.now())
      .toISOString()
      .replace(/[^0-9]/g, "")
      .substring(0, 12),
  )

  return {
    check: async () => {
      const data = await Database.use((tx) =>
        tx
          .select()
          .from(ModelTpmRateLimitTable)
          .where(and(inArray(ModelTpmRateLimitTable.id, ids), eq(ModelTpmRateLimitTable.interval, yyyyMMddHHmm))),
      )

      // convert to map of model to count
      return data.reduce(
        (acc, curr) => {
          acc[curr.id] = curr.count
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
          .values({ id, interval: yyyyMMddHHmm, count: usage })
          .onDuplicateKeyUpdate({ set: { count: sql`${ModelTpmRateLimitTable.count} + ${usage}` } }),
      )
    },
  }
}
