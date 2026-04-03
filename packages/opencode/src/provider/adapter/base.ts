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
}
