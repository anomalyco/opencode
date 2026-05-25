import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: Config.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function isOverflow(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  return tokenCount(input.tokens) >= usable(input)
}

export function tokenCount(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

// Returns true if a previous auto-compaction triggered at `previousTokens` did
// not reduce reported token usage by at least (1 - threshold). Defaults to a
// 5% reduction; anything less than that signals compaction is not making
// progress — typically because the configured context window is smaller than
// what the provider actually serves, so auto-compaction would loop forever.
//
// An exactly-(1-threshold) reduction (e.g. 200K → 190K at the default) counts
// as progress and does NOT trip the guard.
export function autoCompactStalled(input: {
  previousTokens: number | undefined
  currentTokens: number
  threshold?: number
}) {
  if (input.previousTokens === undefined) return false
  return input.currentTokens > input.previousTokens * (input.threshold ?? 0.95)
}
