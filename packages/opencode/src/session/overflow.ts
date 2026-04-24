import type { Config } from "@/config"
import type { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

// Single source of truth for "how many tokens does this assistant turn
// represent in the context window?" — matches how providers bill/account for
// prompt+completion usage. `total` is honored first when the provider reports
// it; the explicit sum is the AI-SDK-compatible fallback.
export function currentTokens(tokens: MessageV2.Assistant["tokens"]): number {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model))
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  return currentTokens(input.tokens) >= usable(input)
}

export * as SessionOverflow from "./overflow"
