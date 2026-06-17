import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function tokenCount(tokens: SessionV1.Assistant["tokens"]) {
  const components =
    tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
  if (tokens.total === undefined) return components
  if (tokens.total <= 0) return components
  return Math.max(tokens.total, components)
}

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const output = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, output)
  const budget = input.model.limit.input ?? context
  return Math.max(0, budget - Math.max(reserved, output))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  return tokenCount(input.tokens) >= usable(input)
}
