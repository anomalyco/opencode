import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * GLM-4.x adapter.
 * Input: tool: func_name\n{...}
 */
export class GlmToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /tool:\s*(\w+)\n(\{[\s\S]*?\})/g

  detect(content: string): boolean {
    return /tool:\s*\w+/.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const calls: ToolCallOpenAI[] = []
    let match: RegExpExecArray | null

    while ((match = this.TOOL_PATTERN.exec(content)) !== null) {
      const args = this.safeJsonParse(match[2])
      if (args !== null) {
        calls.push({
          id: this.generateId(),
          type: "function",
          function: {
            name: match[1],
            arguments: JSON.stringify(args),
          },
        })
      }
    }

    return calls.length > 0 ? calls : null
  }
}
