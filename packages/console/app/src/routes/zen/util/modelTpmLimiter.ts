import { and, Database, eq, inArray, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"

export function createModelTpmLimiter(providers: { id: string; model: string; tpmLimit?: number }[]) {
  const keys = providers.filter((p) => p.tpmLimit).map((p) => `${p.id}/${p.model}`)
  if (keys.length === 0) return

  const yyyyMMddHHmm = new Date(Date.now())
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 12)

  return {
    check: async () => {
      const data = await Database.use((tx) =>
        tx
          .select()
          .from(ModelRateLimitTable)
          .where(and(inArray(ModelRateLimitTable.key, keys), eq(ModelRateLimitTable.interval, yyyyMMddHHmm))),
      )

      // convert to map of model to count
      return data.reduce(
        (acc, curr) => {
          acc[curr.key] = curr.count
          return acc
        },
        {} as Record<string, number>,
      )
    },
    track: async (id: string, model: string, usageInfo: UsageInfo) => {
      const key = `${id}/${model}`
      if (!keys.includes(key)) return
      const usage = usageInfo.inputTokens
      if (usage <= 0) return
      await Database.use((tx) =>
        tx
          .insert(ModelRateLimitTable)
          .values({ key, interval: yyyyMMddHHmm, count: usage })
          .onDuplicateKeyUpdate({ set: { count: sql`${ModelRateLimitTable.count} + ${usage}` } }),
      )
    },
  }
}
