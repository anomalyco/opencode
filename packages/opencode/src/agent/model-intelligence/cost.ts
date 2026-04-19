import { Effect } from "effect"
import type { EffectiveCost, PublishedCost, SubscriptionProvider, BenchmarkDatabase } from "./types"
import benchmarkData from "./benchmarks.json"

const subscriptionProviders: Record<string, SubscriptionProvider> =
  benchmarkData.subscription_providers as Record<string, SubscriptionProvider>

function matchPattern(pattern: string, value: string): boolean {
  const regex = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$")
  return regex.test(value)
}

function findSubscriptionMatch(
  providerId: string,
  modelId: string,
): SubscriptionProvider | undefined {
  for (const sub of Object.values(subscriptionProviders)) {
    if (sub.provider_id === providerId) {
      if (sub.eligible_model_patterns.some((p) => matchPattern(p, modelId))) {
        return sub
      }
    }
  }
  return undefined
}

export const calculateEffectiveCost = Effect.fn("ModelIntelligence.calculateEffectiveCost")(
  function* (providerId: string, modelId: string, publishedCost: PublishedCost): Effect.Effect<EffectiveCost, never> {
    const sub = findSubscriptionMatch(providerId, modelId)

    if (sub) {
      return {
        input_per_1m: 0,
        output_per_1m: 0,
        is_free: true,
        source: sub.cost_to_user === "free" ? "free_tier" : "subscription",
      }
    }

    return {
      input_per_1m: publishedCost.input_per_1m,
      output_per_1m: publishedCost.output_per_1m,
      is_free: false,
      source: "pay_per_token",
    }
  },
)

export const isFreeToUser = Effect.fn("ModelIntelligence.isFreeToUser")(
  function* (providerId: string, modelId: string): Effect.Effect<boolean, never> {
    return findSubscriptionMatch(providerId, modelId) !== undefined
  },
)

export const filterPaidModels = Effect.fn("ModelIntelligence.filterPaidModels")(
  function* (
    models: ReadonlyArray<{ provider_id: string; model_id: string }>,
    noPaidAPIs: boolean,
  ): Effect.Effect<ReadonlyArray<{ provider_id: string; model_id: string }>, never> {
    if (!noPaidAPIs) return models
    return models.filter((m) => findSubscriptionMatch(m.provider_id, m.model_id) !== undefined)
  },
)
