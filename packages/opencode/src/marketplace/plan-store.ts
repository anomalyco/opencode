import { randomUUID } from "crypto"

export type MarketplaceStoredPlan<T> = {
  id: string
  createdAt: number
  expiresAt: number
  revision: number
  value: T
}

export type MarketplacePlanLookup<T> =
  | { ok: true; plan: MarketplaceStoredPlan<T> }
  | { ok: false; reason: "not_found" | "expired" | "consumed" }

export function createMarketplacePlanStore<T>(options?: { ttl?: number; now?: () => number }) {
  const ttl = options?.ttl ?? 5 * 60_000
  const now = options?.now ?? Date.now
  const plans = new Map<string, MarketplaceStoredPlan<T>>()
  const consumed = new Map<string, number>()

  const prune = () => {
    const time = now()
    for (const [id, plan] of plans) {
      if (plan.expiresAt <= time) plans.delete(id)
    }
    for (const [id, expiresAt] of consumed) {
      if (expiresAt <= time) consumed.delete(id)
    }
  }

  const get = (id: string): MarketplacePlanLookup<T> => {
    const plan = plans.get(id)
    if (plan && plan.expiresAt <= now()) {
      plans.delete(id)
      return { ok: false, reason: "expired" }
    }
    if (plan) return { ok: true, plan }
    if (consumed.has(id)) return { ok: false, reason: "consumed" }
    return { ok: false, reason: "not_found" }
  }

  return {
    create(revision: number, value: T) {
      prune()
      const createdAt = now()
      const plan = {
        id: randomUUID(),
        createdAt,
        expiresAt: createdAt + ttl,
        revision,
        value,
      }
      plans.set(plan.id, plan)
      return plan
    },
    get,
    consume(id: string): MarketplacePlanLookup<T> {
      const result = get(id)
      if (!result.ok) return result
      plans.delete(id)
      consumed.set(id, result.plan.expiresAt)
      return result
    },
  }
}
