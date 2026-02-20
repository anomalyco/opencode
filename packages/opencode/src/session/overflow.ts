import type { Config } from "@/config"
import type { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import type { MessageV2 } from "./message-v2"

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  // Reserve headroom so compaction triggers before the next turn overflows.
  // maxOutputTokens() is capped at 32K (OUTPUT_TOKEN_MAX) regardless of the
  // model's raw output limit, so this is never excessively aggressive.
  // Users can override via config.compaction.reserved if needed (#12924).
  const reserved = input.cfg.compaction?.reserved ?? ProviderTransform.maxOutputTokens(input.model)
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - reserved)
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}
