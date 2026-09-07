export * as SessionUsage from "./usage.js"

import type { Usage } from "@opencode-ai/ai"
import { Option, Schema } from "effect"
import { Money } from "@opencode-ai/schema/money"
import type { TokenUsage } from "@opencode-ai/schema/token-usage"
import type { Model } from "@opencode-ai/schema/model"

const finite = (value: number) => (Number.isFinite(value) ? value : 0)
const safe = (value: number | undefined) => Math.max(0, finite(value ?? 0))

const cacheCreation = Schema.decodeUnknownOption(Schema.Struct({ ephemeral_1h_input_tokens: Schema.Finite }))

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
export function calculateCost(
  costs: Model.Info["cost"],
  usage: TokenUsage.Info,
  providerMetadata?: Usage["providerMetadata"],
) {
  const context = usage.input + usage.cache.read + usage.cache.write
  const tier = costs
    .filter((cost) => cost.tier?.type === "context" && context > cost.tier.size)
    .toSorted((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
  const cost = tier ?? costs.find((cost) => cost.tier === undefined)
  if (!cost) return Money.USD.zero
  const creation = cacheCreation(providerMetadata?.anthropic?.cache_creation)
  const write1h = Math.min(
    usage.cache.write,
    safe(Option.isSome(creation) ? creation.value.ephemeral_1h_input_tokens : undefined),
  )
  return Money.USD.make(
    (usage.input * finite(cost.input) +
      (usage.output + usage.reasoning) * finite(cost.output) +
      usage.cache.read * finite(cost.cache.read) +
      // Anthropic's 1h/5m write-price ratio is 2/1.25. Preserve configured write rates, including zero.
      (usage.cache.write + write1h * 0.6) * finite(cost.cache.write)) /
      1_000_000,
  )
}

export type Recorded = { readonly tokens: TokenUsage.Info; readonly cost: Money.USD }

export const record = (usage: Usage | undefined, costs: Model.Info["cost"]): Recorded => {
  const normalized = tokens(usage)
  return { tokens: normalized, cost: calculateCost(costs, normalized, usage?.providerMetadata) }
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
