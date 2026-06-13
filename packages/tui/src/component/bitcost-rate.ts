import type { AssistantMessage } from "@opencode-ai/sdk/v2"

/** Compact per-1M-token rate with trailing zeros trimmed: 5 → "$5", 0.5 → "$0.5". */
export function formatRate(value?: number | null): string | undefined {
  if (value == null) return undefined
  return `$${Number(value.toFixed(4)).toString()}`
}

/** Per-1M-token rates the rate line needs — satisfied by a bitcost row or the local catalog. */
export type RateSummary = { input_price: number; output_price: number }

/** One-line "input / output per 1M" summary for a pricing row. */
export function rateSummary(p: RateSummary): string {
  return [`${formatRate(p.input_price)} in`, `${formatRate(p.output_price)} out`].join(" · ")
}

/** A model's base local-catalog cost (per 1M tokens), as exposed by the plugin Model type. */
type LocalCost = { input: number; output: number }

/**
 * Build a rate summary from the local model catalog — the fallback when bitcost
 * has no pricing row for a model. Uses the model's base input/output rate.
 * Returns undefined when there is no cost or the model is unpriced (input &
 * output both 0, e.g. custom/self-hosted models).
 */
export function localRate(cost: LocalCost | undefined): RateSummary | undefined {
  if (!cost) return undefined
  if (cost.input === 0 && cost.output === 0) return undefined
  return { input_price: cost.input, output_price: cost.output }
}

/** The provider/model of the most recent assistant turn that produced output. */
export function lastTurnModel(
  messages: ReadonlyArray<{ role: string }>,
): { provider: string; model: string } | undefined {
  const last = [...messages]
    .reverse()
    .find((m): m is AssistantMessage => m.role === "assistant" && (m as AssistantMessage).tokens.output > 0)
  return last ? { provider: last.providerID, model: last.modelID } : undefined
}
