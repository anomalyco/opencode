import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Gemma-3 adapter.
 * Input: call: func_name(arg="value")
 */
export class GemmaToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /call:\s*(\w+)\(([\s\S]*?)\)/g
  private readonly ARG_PATTERN = /(\w+)\s*=\s*["']?([^"'\)]+)["']?/g

  detect(content: string): boolean {
    return /call:\s*\w+\(/.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const calls: ToolCallOpenAI[] = []
    let match: RegExpExecArray | null

    while ((match = this.TOOL_PATTERN.exec(content)) !== null) {
      const args: Record<string, unknown> = {}
      let argMatch: RegExpExecArray | null

      while ((argMatch = this.ARG_PATTERN.exec(match[2])) !== null) {
        args[argMatch[1]] = argMatch[2].trim()
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
