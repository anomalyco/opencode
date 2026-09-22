export * as SessionRunnerUsage from "./usage"

import { type ProviderMetadata } from "@opencode-ai/llm"
import type { ModelV2 } from "../../model"

/**
 * Normalized per-step token counts from the LLM stream settlement.
 * `input` is already the non-cached input count.
 */
export type Tokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

const safe = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0)

const emptyRates = { input: 0, output: 0, cache: { read: 0, write: 0 } }

/**
 * Estimate the cost of one provider turn from the model's models.dev rates.
 * Mirrors `Session.getUsage` in packages/opencode, adapted to the V2 catalog
 * cost array: context tiers (including the folded over-200k tier) are picked
 * by the largest `tier.size` below the inclusive context token count, and
 * reasoning tokens are charged at the output rate (see the TODO in legacy
 * `getUsage`). The Copilot `totalNanoAiu` provider override takes precedence.
 */
export const cost = (info: ModelV2.Info, tokens: Tokens, metadata?: ProviderMetadata): number => {
  const totalNanoAiu = metadata?.["copilot"]?.["totalNanoAiu"]
  if (typeof totalNanoAiu === "number" && Number.isFinite(totalNanoAiu) && totalNanoAiu >= 0)
    return totalNanoAiu / 100_000_000_000
  const context = safe(tokens.input + tokens.cache.read + tokens.cache.write)
  const tier = info.cost
    .flatMap((item) => (item.tier?.type === "context" && context > item.tier.size ? [item] : []))
    .sort((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))
    .at(0)
  const rate = tier ?? info.cost.at(0) ?? emptyRates
  return safe(
    (tokens.input * rate.input +
      (tokens.output + tokens.reasoning) * rate.output +
      tokens.cache.read * rate.cache.read +
      tokens.cache.write * rate.cache.write) /
      1_000_000,
  )
}