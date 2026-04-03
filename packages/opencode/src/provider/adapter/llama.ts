import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Llama 3.x Thinking adapter.
 * Input: <think>...</think> + tool_calls JSON
 */
export class LlamaThinkingAdapter extends ToolCallAdapter {
  private readonly THINKING_PATTERN = /<think>[\s\S]*?<\/\|end_header_id\|>/g
  private readonly TOOL_CALLS_PATTERN = /\[{"name":\s*"[^"]+"[\s\S]*?\}/g

  detect(content: string): boolean {
    return /<think>/.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const cleaned = content.replace(this.THINKING_PATTERN, "").trim()

    const toolMatch = cleaned.match(this.TOOL_CALLS_PATTERN)
    if (toolMatch) {
      const calls: ToolCallOpenAI[] = []
      for (const match of toolMatch) {
        try {
          const parsed = JSON.parse(match)
          if (parsed.name) {
            calls.push({
              id: this.generateId(),
              type: "function",
              function: {
                name: parsed.name,
                arguments: JSON.stringify(parsed.arguments ?? {}),
              },
            })
          }
        }
        catch {
          // continue
        }
      }
      if (calls.length > 0) return calls
    }

    return null
  }
}
