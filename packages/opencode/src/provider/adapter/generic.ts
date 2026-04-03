import { ToolCallAdapter, type ToolCallOpenAI } from "./base"

/**
 * Generic JSON fallback adapter.
 * Handles raw JSON tool call objects.
 */
export class GenericToolCallAdapter extends ToolCallAdapter {
  detect(content: string): boolean {
    const parsed = this.safeJsonParse(content.trim())
    return parsed !== null && typeof parsed === "object" && "name" in parsed
  }

  parse(content: string): ToolCallOpenAI[] | null {
    const parsed = this.safeJsonParse(content.trim())
    if (!parsed || typeof parsed !== "object") return null

    if ("name" in parsed) {
      return [{
        id: this.generateId(),
        type: "function",
        function: {
          name: parsed.name as string,
          arguments: JSON.stringify(parsed.arguments ?? {}),
        },
      }]
    }

    if (Array.isArray(parsed)) {
      const calls: ToolCallOpenAI[] = []
      for (const item of parsed) {
        if (typeof item === "object" && item && "name" in item) {
          calls.push({
            id: this.generateId(),
            type: "function",
            function: {
              name: item.name as string,
              arguments: JSON.stringify(item.arguments ?? {}),
            },
          })
        }
      }
      return calls.length > 0 ? calls : null
    }

    return null
  }
}
