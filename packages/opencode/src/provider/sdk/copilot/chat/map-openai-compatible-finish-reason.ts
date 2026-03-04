type V3FinishReasonUnified = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other"

export function mapOpenAICompatibleFinishReason(finishReason: string | null | undefined): V3FinishReasonUnified {
  switch (finishReason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "content_filter":
      return "content-filter"
    case "function_call":
    case "tool_calls":
      return "tool-calls"
    default:
      return "other"
  }
}
