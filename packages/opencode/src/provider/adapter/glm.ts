import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * GLM-4.x adapter.
 * Input: tool: func_name\n{...}
 * Supports: nested JSON via stack-based parsing.
 */
export class GlmToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /tool:\s*(\w+)\n([\s\S]*)/g

  detect(content: string): boolean {
    return /tool:\s*\w+/.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const calls: ToolCallOpenAI[] = []
    let match: RegExpExecArray | null

    while ((match = this.TOOL_PATTERN.exec(content)) !== null) {
      const jsonPart = match[2].trim()

      // Use stack-based JSON extraction for nested structures
      const jsonStr = this.extractBalancedJson(jsonPart)
      if (jsonStr) {
        const args = this.safeJsonParse(jsonStr)
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
    }

    return calls.length > 0 ? calls : null
  }
}
