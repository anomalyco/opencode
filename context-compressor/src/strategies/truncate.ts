/**
 * ============================================================================
 * @ai-context/compressor - Truncate Strategy
 * ============================================================================
 *
 * Simple truncation strategy - keeps the most recent N messages.
 */

import type { Message, TruncateConfig } from '../core/types.js'
import { countMessages } from '../core/token.js'

/**
 * Truncate strategy result
 */
export interface TruncateResult {
  /** Truncated messages */
  messages: Message[]
  /** Original count */
  originalCount: number
  /** New count */
  newCount: number
  /** Tokens saved */
  tokensSaved: number
}

/**
 * Apply truncate strategy
 *
 * Keeps only the most recent N messages.
 *
 * @param messages - Messages to truncate
 * @param config - Truncate configuration
 * @returns Truncation result
 *
 * @example
 * ```ts
 * const result = await truncate(messages, { enabled: true, maxMessages: 10 })
 * console.log(`Removed ${result.originalCount - result.newCount} messages`)
 * ```
 */
export async function truncate(
  messages: Message[],
  config: TruncateConfig
): Promise<TruncateResult> {
  if (!config.enabled || messages.length <= config.maxMessages) {
    return {
      messages: messages.slice(),
      originalCount: messages.length,
      newCount: messages.length,
      tokensSaved: 0,
    }
  }

  const originalCount = messages.length
  const originalTokens = countMessages(messages)

  // Keep only the most recent messages
  const truncated = messages.slice(-config.maxMessages)
  const newTokens = countMessages(truncated)

  return {
    messages: truncated,
    originalCount,
    newCount: truncated.length,
    tokensSaved: originalTokens - newTokens,
  }
}

/**
 * Calculate target message count for truncation
 *
 * @param messages - Current messages
 * @param targetTokens - Target token count
 * @returns Number of messages to keep
 */
export function calculateTargetCount(messages: Message[], targetTokens: number): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = countMessages([messages[i]!])
    if (count + msgTokens > targetTokens) {
      return messages.length - i - 1
    }
    count += msgTokens
  }
  return messages.length
}
