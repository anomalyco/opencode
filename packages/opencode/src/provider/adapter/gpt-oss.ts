import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * GPT-OSS adapter.
 * Input: to=functions.func_name<|channel|>...
 */
export class GptOssToolCallAdapter extends ToolCallAdapter {
  private readonly TOOL_PATTERN = /to=functions\.(\w+)/
  private readonly ARG_PATTERN = /(\w+)[=:]\s*([\w\s]+)/g

  detect(content: string): boolean {
    return /to=functions\./.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const toolMatch = content.match(this.TOOL_PATTERN)
    if (!toolMatch) return null

    const args: Record<string, unknown> = {}
    const argsText = content.slice(toolMatch.index! + toolMatch[0].length)
    let argMatch: RegExpExecArray | null

    while ((argMatch = this.ARG_PATTERN.exec(argsText)) !== null) {
      args[argMatch[1]] = argMatch[2].trim()
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
