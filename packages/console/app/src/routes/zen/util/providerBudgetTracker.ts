import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { buildRateLimitKey, getRedis } from "./redis"
import { logger } from "./logger"

export function createProviderBudgetTracker(
  providers: {
    id: string
    budget?: number
    budgetContribution?: number
    budgetMode?: "always" | "fill"
  }[],
) {
  const tracked = providers.filter(
    (provider) => provider.budget !== undefined && provider.budgetContribution !== undefined,
  )
  if (tracked.length === 0) return undefined

  const interval = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 12)
  const redis = getRedis()
  const keys = Object.fromEntries(
    tracked.map((provider) => [provider.id, buildRateLimitKey("provider-budget", provider.id, interval)]),
  )
  let budgetUsage: Record<string, number> = {}

  return {
    check: async () => {
      const ids = tracked.map((provider) => provider.id)
      if (ids.length === 0) return {}
      const values = await redis.mget<(string | number | null)[]>(ids.map((id) => keys[id]))
      budgetUsage = Object.fromEntries(ids.map((id, index) => [id, Number(values[index] ?? 0)]))
      return budgetUsage
    },
    track: async (provider: string, costInCent: number) => {
      const config = tracked.find((item) => item.id === provider)
      if (!config) return
      if (config.budgetContribution === undefined) return
      const cost = centsToMicroCents(costInCent * config.budgetContribution)
      if (cost <= 0) return
      const pipeline = redis.pipeline()
      pipeline.incrby(keys[provider], cost)
      pipeline.expire(keys[provider], 120)
      await pipeline.exec()
      logger.metric({
        "provider.budget_usage": budgetUsage[provider] + cost,
        "model.budget_usage": cost,
      })
    },
  }
}
