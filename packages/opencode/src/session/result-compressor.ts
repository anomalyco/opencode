/**
 * result-compressor.ts
 *
 * Compresses a large subagent task result string before injecting it into the
 * parent session context. Token budget is derived dynamically from the active
 * model's context window — no hardcoded constants.
 */
import { Token } from "@opencode-ai/core/util/token"

const COMPRESSION_RATIO = 0.08 // target at most 8% of context window per result

/**
 * Compresses `text` to fit within `COMPRESSION_RATIO * contextLimit` tokens.
 * 
 * Strategy (pure, no LLM call to avoid circular dep):
 * - If text fits within budget, return unchanged.
 * - Otherwise extract: first 20% (objective/header), last 60% (conclusion/result),
 *   and a "[... N chars omitted ...]" sentinel in the middle.
 * 
 * A proper LLM-based summary can be wired in later via an injected llm service.
 */
export const compressTaskResult = (text: string, contextLimit: number): string => {
  const tokenBudget = Math.max(Math.floor(contextLimit * COMPRESSION_RATIO), 500)
  if (Token.estimate(text) <= tokenBudget) return text

  const maxChars = tokenBudget * 4 // ~4 chars/token (rough conversion)
  if (text.length <= maxChars) return text

  const headChars = Math.floor(maxChars * 0.25)
  const tailChars = Math.floor(maxChars * 0.65)
  const omitted = text.length - headChars - tailChars

  return [
    text.slice(0, headChars),
    `\n\n[... ${omitted} characters omitted by result-compressor (${Math.round(Token.estimate(text) / 1000)}k tokens → ${tokenBudget} token budget) ...]\n\n`,
    text.slice(-tailChars),
  ].join("")
}
