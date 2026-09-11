export * as AdvisorUsage from "./advisor-usage"

import Decimal from "decimal.js"
import type { ProviderMetadata } from "@opencode-ai/llm"
import type { Provider } from "@/provider/provider"
import { isRecord } from "@/util/record"
import type { SessionAdvisor } from "./advisor"

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0

export function calculate(
  metadata: ProviderMetadata | undefined,
  fallback: string,
  models: Record<string, Provider.Model>,
): SessionAdvisor.Usage | undefined {
  const usage = metadata?.anthropic?.usage
  if (!isRecord(usage) || !Array.isArray(usage.iterations)) return undefined
  const advisors = usage.iterations.filter((value) => isRecord(value) && value.type === "advisor_message")
  if (!advisors.length) return undefined
  let complete = true
  let total = new Decimal(0)
  const iterations = advisors.map((value) => {
    const model = typeof value.model === "string" && value.model ? value.model : fallback
    const raw = [
      value.input_tokens,
      value.output_tokens,
      value.cache_read_input_tokens ?? 0,
      value.cache_creation_input_tokens ?? 0,
    ]
    const tokens = raw.map((value) => (count(value) ? Number(value) : 0))
    const inputContext = tokens[0] + tokens[2] + tokens[3]
    // Anthropic may report a dated snapshot id; fall back to the configured advisor model's pricing.
    const pricing = models[model]?.cost ?? models[fallback]?.cost
    const rates =
      pricing?.tiers
        ?.filter((rate) => rate.tier.type === "context" && inputContext > rate.tier.size)
        .sort((a, b) => b.tier.size - a.tier.size)[0] ??
      (pricing?.experimentalOver200K && inputContext > 200000 ? pricing.experimentalOver200K : pricing)
    const prices = [rates?.input, rates?.output, rates?.cache?.read, rates?.cache?.write]
    const unsupportedTTL =
      isRecord(value.cache_creation) && Number(value.cache_creation.ephemeral_1h_input_tokens ?? 0) > 0
    const valid =
      raw.every(count) && !unsupportedTTL && tokens.every((tokens, index) => tokens === 0 || count(prices[index]))
    const row = { model, input: tokens[0], output: tokens[1], cacheRead: tokens[2], cacheWrite: tokens[3] }
    if (!valid) {
      complete = false
      return row
    }
    const cost = tokens
      .reduce((total, tokens, index) => total.add(new Decimal(tokens).mul(prices[index] ?? 0)), new Decimal(0))
      .div(1000000)
    total = total.add(cost)
    return { ...row, cost: cost.toNumber() }
  })
  return { complete, cost: total.toNumber(), iterations }
}
