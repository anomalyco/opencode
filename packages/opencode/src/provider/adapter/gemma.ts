import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Gemma-3 adapter.
 * Input: call: func_name(arg="value")
 * Enhanced: infers types for booleans, numbers, and null.
 */
export class GemmaToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /call:\s*(\w+)\(([\s\S]*?)\)/g
  private readonly ARG_PATTERN = /(\w+)\s*=\s*([^,\)]+)/g

  detect(content: string): boolean {
    return /call:\s*\w+\(/.test(content)
  }

  /**
   * Infer the correct type for a raw argument string.
   */
  private inferType(raw: string): unknown {
    const trimmed = raw.trim().replace(/^["']|["']$/g, "")

    // Boolean
    if (trimmed === "true") return true
    if (trimmed === "false") return false

    // Null
    if (trimmed === "null") return null

    // Number (integer or float)
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
    if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed)

    // String
    return trimmed
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const calls: ToolCallOpenAI[] = []
    let match: RegExpExecArray | null

    while ((match = this.TOOL_PATTERN.exec(content)) !== null) {
      const args: Record<string, unknown> = {}
      let argMatch: RegExpExecArray | null

      while ((argMatch = this.ARG_PATTERN.exec(match[2])) !== null) {
        args[argMatch[1]] = this.inferType(argMatch[2])
      }

      calls.push({
        id: this.generateId(),
        type: "function",
        function: {
          name: match[1],
          arguments: JSON.stringify(args),
        },
      })
    }

    return calls.length > 0 ? calls : null
  }
}
