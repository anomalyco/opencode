import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const DEFAULT_COMPACTION_BUFFER = 20_000
const MIN_BUFFER = 5_000
const MAX_BUFFER = 40_000
const ADAPTIVE_BUFFER_RATIO = 0.15

function computeBuffer(model: Provider.Model): number {
  const context = model.limit.context ?? model.limit.input
  if (context && context > 0) return Math.max(MIN_BUFFER, Math.min(MAX_BUFFER, Math.round(context * ADAPTIVE_BUFFER_RATIO)))
  return DEFAULT_COMPACTION_BUFFER
}

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(computeBuffer(input.model), ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

export function estimateOverflow(input: {
  cfg: ConfigV1.Info
  estimatedTokens: number
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  const context = input.model.limit.context
  if (context === 0) return false
  const buffer = input.cfg.compaction?.reserved ?? computeBuffer(input.model)
  const maxOutput = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  const budget = (input.model.limit.input ?? context) - maxOutput - buffer
  return input.estimatedTokens >= budget
}
