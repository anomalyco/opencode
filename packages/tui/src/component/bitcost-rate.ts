import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { BitcostPricing } from "./bitcost-api"

/** Compact per-1M-token rate with trailing zeros trimmed: 5 → "$5", 0.5 → "$0.5". */
export function formatRate(value?: number | null): string | undefined {
  if (value == null) return undefined
  return `$${Number(value.toFixed(4)).toString()}`
}

/** One-line "input / output per 1M" summary for a pricing row. */
export function rateSummary(p: BitcostPricing): string {
  return [`${formatRate(p.input_price)} in`, `${formatRate(p.output_price)} out`].join(" · ")
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
