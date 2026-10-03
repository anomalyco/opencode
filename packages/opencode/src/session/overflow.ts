import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000
const CONTEXT_SAFETY_FRACTION = 0.1

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const outputReserve = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  const safety = Math.floor(context * CONTEXT_SAFETY_FRACTION)
  const configured = input.cfg.compaction?.reserved
  if (configured !== undefined) {
    return input.model.limit.input
      ? Math.max(0, input.model.limit.input - configured)
      : Math.max(0, context - outputReserve)
  }

  const inputReserve = Math.max(Math.min(COMPACTION_BUFFER, outputReserve), safety)
  const contextReserve = Math.max(outputReserve, COMPACTION_BUFFER, safety)
  if (input.model.limit.input) {
    return Math.max(0, Math.min(input.model.limit.input - inputReserve, context - contextReserve))
  }
  return Math.max(0, context - contextReserve)
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
