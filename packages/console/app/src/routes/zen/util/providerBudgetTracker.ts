import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { buildRateLimitKey, getRedis } from "./redis"
import { logger } from "./logger"

// Per-provider, per-minute budget with priorities. The budget belongs to a
// provider and is shared across every model that routes to it. Each model's
// provider entry carries a `budgetPriority`: priority 1 ("always") routes
// unconditionally, while higher priorities ("fill") only route while the provider's
// current-minute spend through that priority is still under budget.
//
// Spend is tracked per (provider, priority, minute) so a fill priority can yield its
// leftover headroom to the next priority down. The previous minute is also read so
// higher priorities can reserve the next minute's budget first.
export function createProviderBudgetTracker(
  providers: {
    id: string
    budget?: number
    budgetContribution?: number
    budgetPriority?: number
  }[],
) {
  const tracked = providers.filter(
    (provider) =>
      provider.budget !== undefined &&
      provider.budgetContribution !== undefined &&
      provider.budgetPriority !== undefined,
  )
  if (tracked.length === 0) return undefined

  const intervalAt = (date: Date) =>
    date
      .toISOString()
      .replace(/[^0-9]/g, "")
      .substring(0, 12)
  const now = new Date()
  const currInterval = intervalAt(now)
  const prevInterval = intervalAt(new Date(now.getTime() - 60_000))

  const redis = getRedis()
  const key = (providerId: string, priority: number, withInterval: string) =>
    buildRateLimitKey("provider-budget", `${providerId}:${priority}`, withInterval)

  const budgetByProvider = tracked.reduce<Record<string, number>>((acc, provider) => {
    acc[provider.id] = provider.budget!
    return acc
  }, {})

  const maxPriorityByProvider = tracked.reduce<Record<string, number>>((acc, provider) => {
    acc[provider.id] = Math.max(acc[provider.id] ?? 0, provider.budgetPriority!)
    return acc
  }, {})

  // Effective budget in micro-cents per provider/priority, computed in check()
  // from the configured budget minus previous-minute usage from higher priorities.
  let effectiveBudget: Record<string, Record<number, number>> = {}
  // Cumulative current-minute spend through each priority, per provider.
  let spentThroughPriority: Record<string, Record<number, number>> = {}
  let previousSpentThroughPriority: Record<string, Record<number, number>> = {}

  return {
    // Returns whether a provider at a given priority still has budget headroom.
    // Priority 1 always qualifies; higher priorities qualify only while everything through
    // the current priority hasn't already filled the previous-minute adjusted
    // budget.
    check: async () => {
      const reads = Object.entries(maxPriorityByProvider).flatMap(([providerId, maxPriority]) =>
        Array.from({ length: maxPriority }, (_, index) => index + 1).flatMap((priority) => [
          { providerId, priority, interval: currInterval, prev: false },
          { providerId, priority, interval: prevInterval, prev: true },
        ]),
      )
      const values = await redis.mget<(string | number | null)[]>(
        reads.map((r) => key(r.providerId, r.priority, r.interval)),
      )

      const current: Record<string, Record<number, number>> = {}
      const previous: Record<string, Record<number, number>> = {}
      reads.forEach((r, index) => {
        const amount = Number(values[index] ?? 0)
        if (r.prev) {
          previous[r.providerId] ??= {}
          previous[r.providerId][r.priority] = amount
          return
        }
        current[r.providerId] ??= {}
        current[r.providerId][r.priority] = amount
      })

      effectiveBudget = {}
      spentThroughPriority = {}
      previousSpentThroughPriority = {}
      Object.entries(maxPriorityByProvider).forEach(([providerId, maxPriority]) => {
        const providerBudget = budgetByProvider[providerId]
        if (providerBudget === undefined) return
        const budget = centsToMicroCents(providerBudget * 100)

        let currentRunning = 0
        let previousRunning = 0
        effectiveBudget[providerId] = {}
        spentThroughPriority[providerId] = {}
        previousSpentThroughPriority[providerId] = {}
        Array.from({ length: maxPriority }, (_, index) => index + 1).forEach((priority) => {
          currentRunning += current[providerId]?.[priority] ?? 0
          effectiveBudget[providerId][priority] = Math.max(0, budget - previousRunning)
          previousRunning += previous[providerId]?.[priority] ?? 0
          spentThroughPriority[providerId][priority] = currentRunning
          previousSpentThroughPriority[providerId][priority] = previousRunning
        })
      })

      return {
        // Priority 1 is unconditional. Higher priorities gate on the spend through
        // the current priority against the effective budget.
        qualify: (providerId: string, priority: number) => {
          if (priority <= 1) return true
          const budget = effectiveBudget[providerId]?.[priority]
          if (budget === undefined) return false
          const spentThroughCurrentPriority = spentThroughPriority[providerId]?.[priority] ?? 0
          return spentThroughCurrentPriority < budget
        },
        prefer: (providerId: string, priority: number) => {
          const providerBudget = budgetByProvider[providerId]
          if (providerBudget === undefined) return false
          const budget = centsToMicroCents(providerBudget * 100)
          const previousUsage = previousSpentThroughPriority[providerId]?.[priority]
          if (previousUsage === undefined) return false
          return previousUsage < budget * 0.8
        },
      }
    },
    track: async (provider: string, priority: number | undefined, costInCent: number) => {
      if (priority === undefined) return
      const config = tracked.find((item) => item.id === provider && item.budgetPriority === priority)
      if (!config) return
      if (config.budgetContribution === undefined) return
      const cost = centsToMicroCents(costInCent * config.budgetContribution)
      if (cost <= 0) return
      const redisKey = key(provider, priority, currInterval)
      const pipeline = redis.pipeline()
      pipeline.incrby(redisKey, cost)
      // Keep two minutes so the previous interval is readable for budget adjustment.
      pipeline.expire(redisKey, 120)
      await pipeline.exec()
      logger.metric({
        "provider.budget_usage": cost,
        "provider.budget_priority": priority,
      })
    },
  }
}
