export namespace TokenEstimator {
  // Rough estimate: 1 token ≈ 4 characters for English text
  // This is a conservative estimate that works reasonably well
  const CHARS_PER_TOKEN = 3

  export function estimateTokens(text: string): number {
    // Handle edge case of empty or very short text
    if (text.length === 0) return 0
    if (text.length <= 2) return 1 // Very short text like "Hi" should be 1 token

    // More accurate estimation considering common patterns
    // Whitespace and punctuation tend to be part of tokens
    const charCount = text.length
    const wordCount = text.split(/\s+/).filter(Boolean).length

    // Use a weighted average of character and word-based estimates
    // Words average ~1.3 tokens, chars average ~3-4 per token
    const charEstimate = charCount / CHARS_PER_TOKEN
    const wordEstimate = wordCount * 1.3

    // Return the higher estimate to be conservative
    return Math.ceil(Math.max(charEstimate, wordEstimate))
  }

  export function estimateFileTokens(content: string, encoding: "utf-8" | "base64" = "utf-8"): number {
    if (encoding === "base64") {
      // Base64 increases size by ~33%
      const decodedSize = (content.length * 3) / 4
      return estimateTokens(content) + Math.ceil(decodedSize / CHARS_PER_TOKEN)
    }
    return estimateTokens(content)
  }

  export function isWithinLimit(text: string, maxTokens: number): boolean {
    return estimateTokens(text) <= maxTokens
  }

  export function truncateToTokenLimit(text: string, maxTokens: number): string {
    const estimate = estimateTokens(text)
    if (estimate <= maxTokens) return text

    // Reserve tokens for the truncation message
    const truncationMessage = "\n\n[Content truncated due to size limits]"
    const truncationTokens = estimateTokens(truncationMessage)
    const effectiveLimit = maxTokens - truncationTokens

    // Binary search for the right truncation point with more conservative approach
    let left = 0
    let right = text.length
    let result = ""

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const substr = text.substring(0, mid)
      const substrTokens = estimateTokens(substr)

      if (substrTokens <= effectiveLimit) {
        result = substr
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    // Try to break at a natural boundary (line or word)
    const lastNewline = result.lastIndexOf("\n")
    const lastSpace = result.lastIndexOf(" ")
    const breakPoint = Math.max(lastNewline, lastSpace)

    if (breakPoint > result.length * 0.8) {
      result = result.substring(0, breakPoint)
    }

    return result + truncationMessage
  }
}
