export namespace Token {
  const CHARS_PER_TOKEN = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
  }

  /**
   * Convert token estimate to character count
   * Used when accumulating text across stream deltas
   */
  export function toCharCount(tokenEstimate: number): number {
    return tokenEstimate * CHARS_PER_TOKEN
  }

  /**
   * Convert character count to token estimate
   * Used when converting accumulated text back to tokens
   */
  export function toTokenEstimate(charCount: number): number {
    return Math.round(charCount / CHARS_PER_TOKEN)
  }

  /**
   * Calculate tokens for tool results that will be sent to the API
   * Includes tool input JSON, output (or compaction message), and errors
   */
  export function calculateToolResultTokens(parts: Array<{ type: string; state?: any }>) {
    let tokens = 0
    for (const part of parts) {
      if (part.type === "tool") {
        // Tool input is sent in both completed and error states
        tokens += estimate(JSON.stringify(part.state.input))

        if (part.state.status === "completed") {
          // Tool result output - check if compacted
          const output = part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output
          tokens += estimate(output)
        }

        if (part.state.status === "error") {
          // Tool error text is sent back to the API
          tokens += estimate(part.state.error)
        }
      }
    }
    return tokens
  }
}
