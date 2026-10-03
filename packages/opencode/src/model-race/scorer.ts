import { LLMEvent } from "@opencode-ai/llm"
import { Token } from "@opencode-ai/core/util/token"

export const SWITCH_THRESHOLD = 1.1

export function tokenWeight(event: LLMEvent) {
  if (LLMEvent.is.textDelta(event) || LLMEvent.is.reasoningDelta(event)) {
    return Math.max(1, Token.estimate(event.text))
  }
  return 0
}

export function isFirstToken(event: LLMEvent) {
  return LLMEvent.is.textDelta(event) || LLMEvent.is.reasoningDelta(event)
}

export function isToolCall(event: LLMEvent) {
  return LLMEvent.is.toolCall(event)
}

export function isFinished(event: LLMEvent) {
  return LLMEvent.is.finish(event)
}

export function isProviderError(event: LLMEvent) {
  return LLMEvent.is.providerError(event)
}

export function tokensPerSecond(tokens: number, durationMs: number) {
  if (tokens <= 0 || durationMs <= 0) return undefined
  return tokens / (durationMs / 1000)
}

export function isMeaningfullyFaster(leader?: number, challenger?: number) {
  if (challenger === undefined || challenger <= 0) return false
  if (leader === undefined || leader <= 0) return true
  return challenger > leader * SWITCH_THRESHOLD
}
