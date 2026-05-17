import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000

type ContextConfig = {
  compaction?: {
    auto?: boolean
    reserved?: number
  }
}

type ContextModel = {
  limit: {
    context: number
    input?: number
    output: number
  }
}

export function usable(input: { cfg: ContextConfig; model: ContextModel; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function count(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function percent(input: {
  cfg: ContextConfig
  tokens: MessageV2.Assistant["tokens"]
  model: ContextModel
  outputTokenMax?: number
}) {
  const limit = usable(input)
  if (limit === 0) return null
  return Math.round((count(input.tokens) / limit) * 100)
}

export function isOverflow(input: {
  cfg: Config.Info
  tokens: MessageV2.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  return count(input.tokens) >= usable(input)
}

export * as SessionOverflow from "./overflow"
