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
        // Add null check for part.state
        if (!part.state) continue

        // Safe access to input
        if (part.state.input) {
          tokens += estimate(JSON.stringify(part.state.input))
        }

        if (part.state.status === "completed") {
          // Use optional chaining for compacted check
          const output = part.state.time?.compacted ? "[Old tool result content cleared]" : (part.state.output ?? "")
          tokens += estimate(output)
        }

        if (part.state.status === "error" && part.state.error) {
          tokens += estimate(part.state.error)
        }
      }
    }
    return tokens
  }
}
