import type { LanguageModelV2FinishReason } from "@ai-sdk/provider"

export function mapOpenAICompatibleFinishReason(finishReason: string | null | undefined): LanguageModelV2FinishReason {
  switch (finishReason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "content_filter":
      return "content-filter"
    case "model_context_window_exceeded":
      return "length"
    case "function_call":
    case "tool_calls":
      return "tool-calls"
    default:
      return "unknown"
  }
}
