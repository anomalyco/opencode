export * as SessionUsage from "./usage"

import type { Usage } from "@opencode-ai/ai"
import { Money } from "@opencode-ai/schema/money"
import type { TokenUsage } from "@opencode-ai/schema/token-usage"
import type { ModelV2 } from "../model"

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

export const tokens = (usage: Usage | undefined): TokenUsage.Info => ({
  input: safe(usage?.nonCachedInputTokens),
  output: safe(usage?.visibleOutputTokens),
  reasoning: safe(usage?.reasoningTokens),
  cache: {
    read: safe(usage?.cacheReadInputTokens),
    write: safe(usage?.cacheWriteInputTokens),
  },
})

// TODO(#35765): Use Copilot's reported billed amount once billing has a dedicated typed runtime contract.
export function calculateCost(costs: ModelV2.Info["cost"], usage: TokenUsage.Info) {
  const context = usage.input + usage.cache.read + usage.cache.write
  const tier = costs
    .filter((cost) => cost.tier?.type === "context" && context > cost.tier.size)
    .toSorted((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
  const cost = tier ?? costs.find((cost) => cost.tier === undefined)
  if (!cost) return Money.USD.zero
  return Money.USD.make(
    (usage.input * cost.input +
      (usage.output + usage.reasoning) * cost.output +
      usage.cache.read * cost.cache.read +
      usage.cache.write * cost.cache.write) /
      1_000_000,
  )
}

export type Recorded = { readonly tokens: TokenUsage.Info; readonly cost: Money.USD }

export const record = (usage: Usage | undefined, costs: ModelV2.Info["cost"]): Recorded => {
  const normalized = tokens(usage)
  return { tokens: normalized, cost: calculateCost(costs, normalized) }
}

export const add = (a: Recorded, b: Recorded): Recorded => ({
  cost: Money.USD.make(a.cost + b.cost),
  tokens: {
    input: a.tokens.input + b.tokens.input,
    output: a.tokens.output + b.tokens.output,
    reasoning: a.tokens.reasoning + b.tokens.reasoning,
    cache: {
      read: a.tokens.cache.read + b.tokens.cache.read,
      write: a.tokens.cache.write + b.tokens.cache.write,
    },
  },
})
