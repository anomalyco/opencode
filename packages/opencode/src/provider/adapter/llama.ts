import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Llama 3.x Thinking adapter.
 * Input: <think>...</think> + tool_calls JSON
 * Enhanced: separates Thought (reasoning) from Action (tool calls).
 */
export class LlamaThinkingAdapter extends ToolCallAdapter {
  private readonly THINKING_PATTERN = /<think>[\s\S]*?<\/\|end_header_id\|>/g
  private readonly TOOL_CALLS_PATTERN = /\[{"name":\s*"[^"]+"[\s\S]*?\}/g

  detect(content: string): boolean {
    return /<think>/.test(content)
  }

  /**
   * Parse content and return { toolCalls, thought }.
   * thought contains the reasoning text, toolCalls are the parsed tool calls.
   */
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

  /**
   * Extract the thinking/reasoning text from content.
   * Returns the thought text or null if no thinking tags found.
   */
  extractThought(content: string): string | null {
    const thinkPattern = /<think>([\s\S]*?)<\/\|end_header_id\|>/g
    const thoughts: string[] = []
    let match: RegExpExecArray | null

    while ((match = thinkPattern.exec(content)) !== null) {
      thoughts.push(match[1].trim())
    }

    return thoughts.length > 0 ? thoughts.join("\n\n") : null
  }
}
