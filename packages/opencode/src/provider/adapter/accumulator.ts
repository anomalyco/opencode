import type { ToolCallOpenAI } from "./base"

/**
 * Streaming chunk accumulator for tool call patterns.
 * Buffers incomplete chunks until a complete tool call pattern is detected.
 *
 * Handles cases where llama.cpp splits tool calls across multiple chunks:
 *   Chunk 1: '<tools>{"name": "x", "arg'
 *   Chunk 2: 'uments": {}}'
 *   Chunk 3: '</tools>'
 *
 * Usage:
 *   const acc = new ToolCallAccumulator(parseToolCalls)
 *   acc.push(chunk)  // returns ToolCallOpenAI[] when complete
 */
export class ToolCallAccumulator {
  private buffer = ""
  private openTags = 0
  private hasOpenBrace = false
  private braceDepth = 0

  constructor(
    private readonly parser: (content: string) => ToolCallOpenAI[] | null,
  ) {}

  /**
   * Push a streaming chunk into the accumulator.
   * Returns parsed tool calls only when a complete pattern is detected.
   */
  push(chunk: string): ToolCallOpenAI[] | null {
    if (!chunk) return null

    this.buffer += chunk

    // Track <tools> tag balance
    const openMatches = chunk.match(/<tools>/g)
    const closeMatches = chunk.match(/<\/tools>/g)
    this.openTags += (openMatches?.length ?? 0)
    this.openTags -= (closeMatches?.length ?? 0)

    // Track brace depth for JSON completeness
    for (const ch of chunk) {
      if (ch === "{") {
        this.hasOpenBrace = true
        this.braceDepth++
      }
      if (ch === "}") {
        this.braceDepth--
      }
    }

    // Parse when all tags are closed AND braces are balanced
    if (this.openTags <= 0 && this.hasOpenBrace && this.braceDepth <= 0) {
      const result = this.parser(this.buffer)
      this.reset()
      return result
    }

    // Also try parsing if we have complete content (no open tags but has tool pattern)
    if (this.openTags === 0 && this.buffer.length > 0) {
      const result = this.parser(this.buffer)
      if (result) {
        this.reset()
        return result
      }
    }

    return null
  }

  /**
   * Force flush remaining buffer content.
   * Use this when the stream ends to catch any leftover data.
   */
  flush(): ToolCallOpenAI[] | null {
    if (!this.buffer.trim()) return null
    const result = this.parser(this.buffer)
    this.reset()
    return result
  }

  /**
   * Check if there's buffered content waiting.
   */
  get hasPending(): boolean {
    return this.buffer.length > 0
  }

  private reset(): void {
    this.buffer = ""
    this.openTags = 0
    this.hasOpenBrace = false
    this.braceDepth = 0
  }
}
