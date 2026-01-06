import type { MessageV2 } from "../message-v2"
import type { CompactionSchema } from "./schema"

/**
 * Deterministic extractors that parse messages without using LLM.
 * These extract structured information from tool calls and outputs.
 */
export namespace DeterministicExtractor {
  // Error patterns to match in tool outputs
  // Order matters: specific patterns first, then general ones
  const ERROR_PATTERNS = [
    // Specific JS/TS error types - capture the full error including type
    /((?:TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError):\s*.+?)(?:\n|$)/gi,
    // General Error/Exception pattern (avoid matching specific types above)
    /(?<![A-Za-z])((?:Error|Exception|Failed|Failure):\s*.+?)(?:\n|$)/gi,
    // Python tracebacks
    /Traceback \(most recent call last\):[\s\S]+?(?=\n\n|\Z)/gi,
    // Test failures
    /(?:FAILED|ERROR)\s+(.+?)(?:\n|$)/gi,
    // Rust errors
    /error\[E\d+\]:\s*(.+?)(?:\n|$)/gi,
  ]

  // Resolution indicators that suggest an error was fixed
  const RESOLUTION_INDICATORS = /(?:fixed|resolved|working|passed|success|✓|done|all tests passed)/gi

  /**
   * Extract file information from tool calls
   */
  export function extractFiles(messages: MessageV2.WithParts[]): {
    files_read: string[]
    files_modified: Array<{ path: string; change_summary?: string }>
    files_created: string[]
  } {
    const filesRead = new Set<string>()
    const filesModified = new Map<string, string | undefined>()
    const filesCreated = new Set<string>()

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        if (part.state.status !== "completed" && part.state.status !== "error") continue

        const toolName = part.tool.toLowerCase()
        const input = part.state.input || {}

        // Extract file path from common input patterns
        const filePath = extractFilePath(input)
        if (!filePath) continue

        // Categorize based on tool type
        if (toolName === "read" || toolName === "view") {
          filesRead.add(filePath)
        } else if (toolName === "edit" || toolName === "str_replace" || toolName === "patch") {
          const changeSummary = extractChangeSummary(input)
          filesModified.set(filePath, changeSummary)
        } else if (toolName === "write" || toolName === "create") {
          filesCreated.add(filePath)
        }
        // Note: Glob results are not added to files_read as they're just discovered, not read
      }
    }

    // Remove files that were modified or created from the read set
    for (const path of filesModified.keys()) {
      filesRead.delete(path)
    }
    for (const path of filesCreated) {
      filesRead.delete(path)
    }

    return {
      files_read: [...filesRead].sort(),
      files_modified: [...filesModified.entries()].map(([path, change_summary]) => ({
        path,
        change_summary,
      })),
      files_created: [...filesCreated].sort(),
    }
  }

  /**
   * Extract file path from tool input
   */
  function extractFilePath(input: Record<string, unknown>): string | undefined {
    // Common field names for file paths
    const pathFields = ["file_path", "path", "filePath", "filename"]
    for (const field of pathFields) {
      if (typeof input[field] === "string") {
        return input[field] as string
      }
    }
    return undefined
  }

  /**
   * Extract change summary from edit tool input
   */
  function extractChangeSummary(input: Record<string, unknown>): string | undefined {
    const oldStr = input.old_string as string | undefined
    const newStr = input.new_string as string | undefined

    if (oldStr && newStr) {
      const oldPreview = oldStr.slice(0, 30).replace(/\n/g, " ")
      const newPreview = newStr.slice(0, 30).replace(/\n/g, " ")
      return `Changed "${oldPreview}${oldStr.length > 30 ? "..." : ""}" to "${newPreview}${newStr.length > 30 ? "..." : ""}"`
    }

    return undefined
  }

  /**
   * Extract errors from tool outputs and text
   */
  export function extractErrors(messages: MessageV2.WithParts[]): Array<{
    message: string
    resolved: boolean
    resolution?: string
  }> {
    const errors: Array<{ message: string; position: number; resolved: boolean }> = []
    let fullText = ""
    let currentPosition = 0

    // Build full text with position tracking
    for (const msg of messages) {
      for (const part of msg.parts) {
        let partText = ""

        if (part.type === "tool") {
          if (part.state.status === "completed") {
            partText = part.state.output || ""
          } else if (part.state.status === "error") {
            // Error status means the tool itself failed
            partText = `Error: ${part.state.error}`
          }
        } else if (part.type === "text") {
          partText = part.text || ""
        }

        // Extract errors with positions
        for (const pattern of ERROR_PATTERNS) {
          // Reset regex lastIndex for global patterns
          pattern.lastIndex = 0
          let match
          while ((match = pattern.exec(partText)) !== null) {
            const errorText = (match[1] || match[0]).trim().slice(0, 200)
            errors.push({
              message: errorText,
              position: currentPosition + (match.index || 0),
              resolved: false,
            })
          }
        }

        fullText += partText + "\n"
        currentPosition = fullText.length
      }
    }

    // Check if errors were resolved (look for success indicators after error)
    for (const error of errors) {
      const afterError = fullText.slice(error.position)
      if (RESOLUTION_INDICATORS.test(afterError)) {
        error.resolved = true
      }
    }

    // Deduplicate errors by message prefix
    const unique = new Map<string, (typeof errors)[0]>()
    for (const e of errors) {
      const key = e.message.slice(0, 50)
      // Keep resolved version if we have both resolved and unresolved
      if (!unique.has(key) || e.resolved) {
        unique.set(key, e)
      }
    }

    return [...unique.values()].map((e) => ({
      message: e.message,
      resolved: e.resolved,
    }))
  }

  /**
   * Extract and consolidate tool calls
   */
  export function extractToolCalls(messages: MessageV2.WithParts[]): Array<{
    tool: string
    summary: string
    success: boolean
  }> {
    const toolStats = new Map<string, { count: number; success: number }>()

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue

        const toolName = part.tool
        const stats = toolStats.get(toolName) || { count: 0, success: 0 }
        stats.count++

        // Count as success if completed without error in output
        if (part.state.status === "completed") {
          const output = part.state.output || ""
          const hasError = /error|failed|exception/i.test(output)
          if (!hasError) {
            stats.success++
          }
        }

        toolStats.set(toolName, stats)
      }
    }

    return [...toolStats.entries()].map(([tool, stats]) => ({
      tool,
      summary: `${stats.count}x (${stats.success}/${stats.count} successful)`,
      success: stats.success > stats.count / 2,
    }))
  }

  /**
   * Create a condensed text representation of extraction results
   * This is used as context for the LLM instead of full message history
   */
  export function condenseContext(
    artifacts: CompactionSchema.Artifacts,
    errors: Array<{ message: string; resolved: boolean }>,
    toolCalls: Array<{ tool: string; summary: string; success: boolean }>
  ): string {
    const resolvedCount = errors.filter((e) => e.resolved).length

    const lines: string[] = [
      "# Session Summary (Deterministic Extraction)",
      "",
      "## Files",
      `- Files read: ${artifacts.files_read.length}`,
      ...artifacts.files_read.slice(0, 10).map((f) => `  - ${f}`),
      artifacts.files_read.length > 10 ? `  - ... and ${artifacts.files_read.length - 10} more` : "",
      `- Files modified: ${artifacts.files_modified.length}`,
      ...artifacts.files_modified.slice(0, 10).map((f) => `  - ${f.path}${f.change_summary ? `: ${f.change_summary}` : ""}`),
      `- Files created: ${artifacts.files_created.length}`,
      ...artifacts.files_created.slice(0, 5).map((f) => `  - ${f}`),
      "",
      "## Tool Usage",
      ...toolCalls.map((t) => `- ${t.tool}: ${t.summary}`),
      "",
      `## Errors: ${errors.length} (${resolvedCount} resolved)`,
      ...errors.slice(0, 5).map((e) => `- ${e.resolved ? "✓" : "⚠"} ${e.message.slice(0, 100)}`),
      errors.length > 5 ? `- ... and ${errors.length - 5} more errors` : "",
    ]

    return lines.filter((l) => l !== "").join("\n")
  }
}
