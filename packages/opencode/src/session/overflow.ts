import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const outputBudget = input.model.limit.output
  // The model's usable input budget is bounded by its explicit input cap
  // (`limit.input`) when present, otherwise by the context window minus the
  // output budget. We never let the ceiling exceed what still leaves room for a
  // full response inside the context window. This is what makes auto-compaction
  // reachable for models whose real input cap sits well below
  // `context - reserved` — e.g. opencode-go/hy3, where the provider pins input
  // at 262144 - 65536 = 196608 while models.dev advertises context 256000 and
  // output 64000 (issue #45168).
  const inputCeiling = input.model.limit.input ?? Math.max(0, context - outputBudget)
  const effectiveCeiling = Math.max(0, Math.min(inputCeiling, context - outputBudget))

  // Reserve headroom for the next response plus the configured compaction buffer.
  const output = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, output)
  return Math.max(0, effectiveCeiling - Math.min(reserved, outputBudget))
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
