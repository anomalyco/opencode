/**
 * Token estimation utilities for LLM context windows.
 *
 * Provides methods to estimate the number of tokens that text will consume
 * when sent to a language model. Uses a simple heuristic of ~4 characters per token.
 *
 * @example
 * ```typescript
 * Token.estimate("Hello world") // ~3 tokens
 * ```
 */
export namespace Token {
  const CHARS_PER_TOKEN = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
  }
}
