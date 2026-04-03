import { ToolCallAdapter, type ToolCallOpenAI } from "./base"
import { QwenToolCallAdapter } from "./qwen"
import { GptOssToolCallAdapter } from "./gpt-oss"
import { LlamaThinkingAdapter } from "./llama"
import { GlmToolCallAdapter } from "./glm"
import { GemmaToolCallAdapter } from "./gemma"
import { GenericToolCallAdapter } from "./generic"

// Detection order: most specific first, generic last
const adapters: ToolCallAdapter[] = [
  new QwenToolCallAdapter(),
  new GptOssToolCallAdapter(),
  new LlamaThinkingAdapter(),
  new GlmToolCallAdapter(),
  new GemmaToolCallAdapter(),
  new GenericToolCallAdapter(),
]

/**
 * Detect and parse tool calls from model output content.
 * Returns OpenAI-standard tool_calls or null if none found.
 */
export function parseToolCalls(content: string): ToolCallOpenAI[] | null {
  if (!content || content.trim().length === 0) return null

  for (const adapter of adapters) {
    if (adapter.detect(content)) {
      const result = adapter.parse(content)
      if (result && result.length > 0) {
        return result
      }
    }
  }

  return null
}

/**
 * Recommend a specific adapter based on model name (optional optimization).
 */
export function getAdapterForModel(modelName: string): ToolCallAdapter | null {
  const lower = modelName.toLowerCase()

  if (lower.includes("qwen")) return new QwenToolCallAdapter()
  if (lower.includes("gpt-oss")) return new GptOssToolCallAdapter()
  if (lower.includes("llama") && lower.includes("thinking")) return new LlamaThinkingAdapter()
  if (lower.includes("glm")) return new GlmToolCallAdapter()
  if (lower.includes("gemma")) return new GemmaToolCallAdapter()

  return null
}

export type { ToolCallOpenAI } from "./base"
export { ToolCallAdapter } from "./base"
export { ToolCallAccumulator } from "./accumulator"
