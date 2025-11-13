import { Config } from "../config/config"
import { MessageV2 } from "./message-v2"
import { Identifier } from "../id/id"

export namespace ContextFilter {
  /**
   * Filters parent session context based on agent context configuration
   */
  export function filter(messages: MessageV2.WithParts[], config: Config.ContextFilter | undefined): MessageV2.Part[] {
    // Default to "none" mode if no config provided
    if (!config || config.mode === "none") {
      return []
    }

    if (config.mode === "full") {
      return convertMessagesToParts(messages, config)
    }

    if (config.mode === "summary") {
      return createSummary(messages, config)
    }

    if (config.mode === "filtered") {
      return filterSelective(messages, config)
    }

    return []
  }

  /**
   * Convert messages to parts with no filtering
   */
  function convertMessagesToParts(messages: MessageV2.WithParts[], config: Config.ContextFilter): MessageV2.Part[] {
    if (!config) return []

    let filtered = messages

    // Apply max messages limit
    if (config.maxMessages) {
      filtered = filtered.slice(-config.maxMessages)
    }

    const parts: MessageV2.Part[] = []
    for (const msg of filtered) {
      for (const part of msg.parts) {
        parts.push(part)
      }
    }

    // Apply token limit if specified (rough estimate based on parts)
    if (config.maxTokens) {
      return applyTokenLimit(parts, config.maxTokens)
    }

    return parts
  }

  /**
   * Create a compact summary of the session
   */
  function createSummary(messages: MessageV2.WithParts[], config: Config.ContextFilter): MessageV2.Part[] {
    if (!config) return []

    const parts: MessageV2.Part[] = []

    // Count tool invocations
    const toolCounts: Record<string, number> = {}
    const fileChanges = new Set<string>()
    let userMessages = 0
    let assistantMessages = 0

    for (const msg of messages) {
      if (msg.info.role === "user") userMessages++
      if (msg.info.role === "assistant") assistantMessages++

      for (const part of msg.parts) {
        if (part.type === "tool" && part.state.status === "completed") {
          const toolName = (part as MessageV2.ToolPart).tool
          toolCounts[toolName] = (toolCounts[toolName] || 0) + 1

          // Track file changes
          if (toolName === "edit" || toolName === "write") {
            const input = part.state.input as any
            if (input?.filePath) {
              fileChanges.add(input.filePath)
            }
          }
        }
      }
    }

    // Create summary text
    const summaryLines: string[] = []
    summaryLines.push("**Parent Session Summary:**")
    summaryLines.push(`- ${userMessages} user messages, ${assistantMessages} assistant responses`)

    if (Object.keys(toolCounts).length > 0) {
      summaryLines.push("- Tool usage:")
      for (const [tool, count] of Object.entries(toolCounts)) {
        summaryLines.push(`  - ${tool}: ${count}×`)
      }
    }

    if (fileChanges.size > 0 && config.includeFileChanges) {
      summaryLines.push("- Modified files:")
      for (const file of Array.from(fileChanges).slice(0, 10)) {
        summaryLines.push(`  - ${file}`)
      }
      if (fileChanges.size > 10) {
        summaryLines.push(`  - ... and ${fileChanges.size - 10} more`)
      }
    }

    // Create a synthetic text part with the summary
    const summaryPart: MessageV2.TextPart = {
      id: Identifier.ascending("part"),
      sessionID: messages[0]?.info.sessionID || "",
      messageID: messages[0]?.info.id || "",
      type: "text",
      text: summaryLines.join("\n"),
      synthetic: true,
    }

    parts.push(summaryPart)
    return parts
  }

  /**
   * Selectively filter messages based on configuration
   */
  function filterSelective(messages: MessageV2.WithParts[], config: Config.ContextFilter): MessageV2.Part[] {
    if (!config) return []

    const parts: MessageV2.Part[] = []

    // Apply message limit first
    let filtered = messages
    if (config.maxMessages) {
      filtered = filtered.slice(-config.maxMessages)
    }

    for (const msg of filtered) {
      // Filter by message type if specified
      if (config.includeMessageTypes && !config.includeMessageTypes.includes(msg.info.role as any)) {
        continue
      }

      for (const part of msg.parts) {
        // Include text parts from matching roles
        if (part.type === "text") {
          parts.push(part)
          continue
        }

        // Filter tool results
        if (part.type === "tool") {
          const toolPart = part as MessageV2.ToolPart
          if (
            config.includeToolResults &&
            config.includeToolResults.includes(toolPart.tool) &&
            toolPart.state.status === "completed"
          ) {
            parts.push(part)
          }
          continue
        }

        // Include file parts
        if (part.type === "file") {
          parts.push(part)
          continue
        }
      }
    }

    // Apply token limit
    if (config.maxTokens) {
      return applyTokenLimit(parts, config.maxTokens)
    }

    return parts
  }

  /**
   * Apply token limit by truncating parts (rough estimation)
   */
  function applyTokenLimit(parts: MessageV2.Part[], maxTokens: number): MessageV2.Part[] {
    // Rough estimate: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4
    let totalChars = 0
    const result: MessageV2.Part[] = []

    for (const part of parts) {
      const partSize = estimatePartSize(part)

      if (totalChars + partSize <= maxChars) {
        result.push(part)
        totalChars += partSize
      } else {
        // Try to include a truncated version if it's a text part
        if (part.type === "text") {
          const remaining = maxChars - totalChars
          if (remaining > 100) {
            const truncatedPart: MessageV2.TextPart = {
              ...part,
              text: (part as MessageV2.TextPart).text.substring(0, remaining) + "\n...(truncated)",
            }
            result.push(truncatedPart)
          }
        }
        break
      }
    }

    return result
  }

  /**
   * Estimate the size of a part in characters
   */
  function estimatePartSize(part: MessageV2.Part): number {
    if (part.type === "text") {
      return (part as MessageV2.TextPart).text.length
    }

    if (part.type === "tool") {
      const toolPart = part as MessageV2.ToolPart
      if (toolPart.state.status === "completed") {
        return toolPart.state.output.length + JSON.stringify(toolPart.state.input).length
      }
      return 100 // Rough estimate for non-completed tools
    }

    if (part.type === "file") {
      return 500 // Rough estimate for file parts
    }

    return 50 // Default estimate for other part types
  }
}
