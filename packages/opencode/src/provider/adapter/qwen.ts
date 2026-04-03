import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Qwen2.5/3/3.5 adapter.
 * Input: <tools>{"name":"x","arguments":{...}}</tools>
 */
export class QwenToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /<tools>\s*(\{[\s\S]*?\})\s*<\/tools>/g

  detect(content: string): boolean {
    return /<tools>/.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const calls: ToolCallOpenAI[] = []
    let match: RegExpExecArray | null

    while ((match = this.TOOL_PATTERN.exec(content)) !== null) {
      const parsed = this.safeJsonParse(match[1])
      if (parsed && typeof parsed.name === "string") {
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

    return calls.length > 0 ? calls : null
  }
}
