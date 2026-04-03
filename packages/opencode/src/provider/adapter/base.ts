/**
 * Base interface for tool call adapters.
 * Each adapter converts a model-specific tool calling format
 * into the OpenAI standard tool_calls JSON structure.
 */
export interface ToolCallOpenAI {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export abstract class ToolCallAdapter {
  abstract detect(content: string): boolean
  abstract parse(content: string): ToolCallOpenAI[] | null

  protected generateId(): string {
    return `call_${crypto.randomUUID().slice(0, 8)}`
  }

  protected safeJsonParse(str: string): Record<string, unknown> | null {
    try {
      return JSON.parse(str)
    }
    catch {
      return null
    }
  }

  /**
   * Extract balanced JSON using stack-based brace counting.
   * Handles nested objects, escaped quotes, and string boundaries.
   */
  protected extractBalancedJson(text: string): string | null {
    const start = text.indexOf("{")
    if (start === -1) return null

    let depth = 0
    let inString = false
    let escape = false

    for (let i = start; i < text.length; i++) {
      const ch = text[i]

      if (escape) {
        escape = false
        continue
      }

      if (ch === "\\") {
        escape = true
        continue
      }

      if (ch === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (ch === "{") depth++
      if (ch === "}") {
        depth--
        if (depth === 0) {
          return text.slice(start, i + 1)
        }
      }
    }

    return null
  }

  /**
   * Extract all balanced JSON objects from text.
   */
  protected extractAllBalancedJson(text: string): string[] {
    const results: string[] = []
    let remaining = text

    while (true) {
      const json = this.extractBalancedJson(remaining)
      if (!json) break
      results.push(json)
      const idx = remaining.indexOf(json) + json.length
      remaining = remaining.slice(idx)
    }

    return results
  }
}
