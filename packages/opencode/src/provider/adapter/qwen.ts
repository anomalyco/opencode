import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Qwen2.5/3/3.5 adapter.
 * Input: <tools>{"name":"x","arguments":{...}}</tools>
 * Supports: multiple tags, nested JSON, streaming chunks.
 */
export class QwenToolCallAdapter extends ToolCallAdapter {
  detect(content: string): boolean {
    return /<tools>/.test(content)
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const calls: ToolCallOpenAI[] = []

    // Find all <tools>...</tools> regions
    const tagPattern = /<tools>([\s\S]*?)<\/tools>/g
    let tagMatch: RegExpExecArray | null

    while ((tagMatch = tagPattern.exec(content)) !== null) {
      const inner = tagMatch[1].trim()

      // Try balanced JSON extraction for nested structures
      const jsonStr = this.extractBalancedJson(inner)
      if (jsonStr) {
        const parsed = this.safeJsonParse(jsonStr)
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

      // Fallback: try as array of objects
      if (calls.length === 0) {
        const jsonStrs = this.extractAllBalancedJson(inner)
        for (const js of jsonStrs) {
          const parsed = this.safeJsonParse(js)
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
      }
    }

    return calls.length > 0 ? calls : null
  }
}
