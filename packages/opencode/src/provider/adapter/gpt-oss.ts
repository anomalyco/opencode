import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * GPT-OSS adapter.
 * Input: to=functions.func_name<|channel|>...
 * Enhanced: handles key=value, key:value, and quoted strings.
 */
export class GptOssToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /to=functions\.(\w+)/
  private readonly ARG_PATTERN = /(\w+)[=:]\s*("[^"]*"|'[^']*'|[^\s<|,]+)/g

  detect(content: string): boolean {
    return /to=functions\./.test(content)
  }

  /**
   * Infer type for raw argument value.
   */
  private inferType(raw: string): unknown {
    const trimmed = raw.trim()

    // Quoted string
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1)
    }

    // Boolean
    if (trimmed === "true") return true
    if (trimmed === "false") return false

    // Null
    if (trimmed === "null") return null

    // Number
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
    if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed)

    return trimmed
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const toolMatch = content.match(this.TOOL_PATTERN)
    if (!toolMatch) return null

    const args: Record<string, unknown> = {}
    const argsText = content.slice(toolMatch.index! + toolMatch[0].length)
    let argMatch: RegExpExecArray | null

    while ((argMatch = this.ARG_PATTERN.exec(argsText)) !== null) {
      args[argMatch[1]] = this.inferType(argMatch[2])
    }

    return [{
      id: this.generateId(),
      type: "function",
      function: {
        name: toolMatch[1],
        arguments: JSON.stringify(args),
      },
    }]
  }
}
