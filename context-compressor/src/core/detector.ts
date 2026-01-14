/**
 * ============================================================================
 * @ai-context/compressor - Overflow Detection
 * ============================================================================
 *
 * Context overflow detection utilities.
 */

import type { CompressionConfig, Message } from './types.js'
import { countMessages } from './token.js'

/**
 * Check if messages exceed the context limit
 *
 * @param messages - Array of messages
 * @param config - Compression configuration
 * @returns True if overflow detected
 *
 * @example
 * ```ts
 * const isFull = isOverflow(messages, { maxTokens: 100000, outputReserve: 4000 })
 * ```
 */
export function isOverflow(messages: Message[], config: CompressionConfig): boolean {
  const overflow = calculateOverflow(messages, config)
  return overflow.overflow > 0
}

/**
 * Calculate overflow details
 *
 * @param messages - Array of messages
 * @param config - Compression configuration
 * @returns Overflow details
 *
 * @example
 * ```ts
 * const { overflow, total, usable } = calculateOverflow(messages, config)
 * console.log(`Over by ${overflow} tokens (${total}/${usable})`)
 * ```
 */
export function calculateOverflow(
  messages: Message[],
  config: CompressionConfig
): {
  /** Overflow amount (0 if no overflow) */
  overflow: number
  /** Total tokens used */
  total: number
  /** Usable tokens (context - output reserve) */
  usable: number
  /** Context window size */
  context: number
  /** Reserved for output */
  outputReserve: number
} {
  const total = countMessages(messages)
  const context = config.maxTokens
  const outputReserve = config.outputReserve
  const usable = context - outputReserve
  const overflow = Math.max(0, total - usable)

  return {
    overflow,
    total,
    usable,
    context,
    outputReserve,
  }
}

/**
 * Estimate compression target
 *
 * Calculates how many tokens need to be removed to fit within limits.
 *
 * @param messages - Array of messages
 * @param config - Compression configuration
 * @param safetyMargin - Additional margin (default: 0)
 * @returns Tokens to remove
 *
 * @example
 * ```ts
 * const target = getCompressionTarget(messages, config, 1000)
 * console.log(`Need to remove ${target} tokens`)
 * ```
 */
export function getCompressionTarget(
  messages: Message[],
  config: CompressionConfig,
  safetyMargin = 0
): number {
  const { overflow } = calculateOverflow(messages, config)
  return overflow + safetyMargin
}

/**
 * Calculate compression efficiency
 *
 * @param originalCount - Original token count
 * @param newCount - New token count after compression
 * @returns Efficiency percentage (0-100)
 *
 * @example
 * ```ts
 * const efficiency = calculateEfficiency(100000, 60000)
 * console.log(`Compression efficiency: ${efficiency}%`) // 40%
 * ```
 */
export function calculateEfficiency(originalCount: number, newCount: number): number {
  if (originalCount === 0) return 0
  const saved = originalCount - newCount
  return Math.round((saved / originalCount) * 100)
}

/**
 * Predict next message size
 *
 * Estimates the size of the next assistant message based on historical data.
 *
 * @param messages - Array of messages
 * @returns Estimated next message size in tokens
 *
 * @example
 * ```ts
 * const estimatedSize = predictNextSize(messages)
 * ```
 */
export function predictNextSize(messages: Message[]): number {
  // Find assistant messages with token stats
  const assistantMessages = messages.filter(
    (msg): msg is Extract<Message, { role: 'assistant' }> =>
      msg.role === 'assistant' && msg.tokens !== undefined
  )

  if (assistantMessages.length === 0) {
    return 1000 // Default estimate
  }

  // Calculate average output tokens
  const totalOutput = assistantMessages.reduce((sum, msg) => {
    return sum + (msg.tokens?.output || 0)
  }, 0)

  return Math.round(totalOutput / assistantMessages.length)
}
