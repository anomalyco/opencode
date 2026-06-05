import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function effectiveLimit(model: Provider.Model, variant?: string): Provider.Model["limit"] {
  if (!variant || !model.variants) return model.limit
  const v = model.variants[variant]
  if (!v?.limit) return model.limit
  return {
    context: v.limit.context ?? model.limit.context,
    input: v.limit.input ?? model.limit.input,
    output: v.limit.output ?? model.limit.output,
  }
}

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number; variant?: string }) {
  const limit = effectiveLimit(input.model, input.variant)
  if (limit.context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return limit.input
    ? Math.max(0, limit.input - reserved)
    : Math.max(0, limit.context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
  variant?: string
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (effectiveLimit(input.model, input.variant).context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}
