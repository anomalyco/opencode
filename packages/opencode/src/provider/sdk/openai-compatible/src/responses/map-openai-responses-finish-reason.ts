import type { LanguageModelV2FinishReason } from "@ai-sdk/provider"

export function mapOpenAIResponseFinishReason({
  finishReason,
  hasFunctionCall,
}: {
  finishReason: string | null | undefined
  // flag that checks if there have been client-side tool calls (not executed by openai)
  hasFunctionCall: boolean
}): LanguageModelV2FinishReason {
  // 1) 作用: 统一 finishReason；解释: 将 OpenAI 响应原因映射为内部标准枚举
  switch (finishReason) {
    case undefined:
    case null:
      // 2) 作用: 无明确原因时回退；解释: 若本地工具调用存在则标记 tool-calls，否则视为正常 stop
      return hasFunctionCall ? "tool-calls" : "stop"
    case "max_output_tokens":
      // 3) 作用: 标记长度截断；解释: 触发输出长度上限
      return "length"
    case "content_filter":
      // 4) 作用: 标记内容过滤；解释: 由安全过滤导致中断
      return "content-filter"
    default:
      // 5) 作用: 兜底未知原因；解释: 未识别原因时沿用 tool-calls/unknown
      return hasFunctionCall ? "tool-calls" : "unknown"
  }
}
