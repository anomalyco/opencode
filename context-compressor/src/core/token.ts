/**
 * ============================================================================
 * @ai-context/compressor - Token Estimation
 * ============================================================================
 *
 * Token estimation utilities using character-based heuristics.
 */

import type { Message, MessagePart, ToolPart } from './types.js'

/**
 * Average characters per token for most LLMs
 * Based on GPT-4, Claude, and LLaMA averages
 */
const CHARS_PER_TOKEN = 4

/**
 * Estimate token count from text
 *
 * @param text - Input text
 * @returns Estimated token count
 *
 * @example
 * ```ts
 * estimate("Hello world") // 3
 * estimate("") // 0
 * ```
 */
export function estimate(text: string): number {
  const normalized = text ?? ''
  return Math.max(0, Math.round(normalized.length / CHARS_PER_TOKEN))
}

/**
 * Count tokens in a tool part
 *
 * @param part - Tool part
 * @returns Token count
 */
function countToolPart(part: ToolPart): number {
  // Only count output if present and not compacted
  if (part.output && !part.compacted) {
    return estimate(part.output)
  }
  return 0
}

/**
 * Count tokens in a message part
 *
 * @param part - Message part
 * @returns Token count
 */
function countPart(part: MessagePart): number {
  switch (part.type) {
    case 'text':
      return estimate(part.content)
    case 'tool':
      return countToolPart(part)
    case 'file':
      return estimate(part.url)
    case 'reasoning':
      return estimate(part.content)
  }
}

/**
 * Count tokens in a single message
 *
 * @param message - Message to count
 * @returns Token count
 *
 * @example
 * ```ts
 * const msg: UserMessage = {
 *   id: '1',
 *   role: 'user',
 *   timestamp: Date.now(),
 *   content: 'Hello, how are you?'
 * }
 * countMessage(msg) // 5
 * ```
 */
export function countMessage(message: Message): number {
  if (message.role === 'user' || message.role === 'system') {
    return estimate(message.content)
  }

  // For assistant messages, count parts or use token stats if available
  if (message.tokens) {
    const { input, output, cacheRead = 0, reasoning = 0 } = message.tokens
    // Return actual usage if available
    if (input > 0 || output > 0) {
      return input + output + cacheRead + reasoning
    }
  }

  // Otherwise, estimate from parts
  return message.parts.reduce((sum, part) => sum + countPart(part), 0)
}

/**
 * Count total tokens in a message list
 *
 * @param messages - Array of messages
 * @returns Total token count
 *
 * @example
 * ```ts
 * const messages: Message[] = [msg1, msg2, msg3]
 * countMessages(messages) // 150
 * ```
 */
export function countMessages(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + countMessage(msg), 0)
}

/**
 * Calculate token statistics for a message list
 *
 * @param messages - Array of messages
 * @returns Token statistics by role
 *
 * @example
 * ```ts
 * const stats = getMessageStats(messages)
 * console.log(stats.user) // User message tokens
 * console.log(stats.assistant) // Assistant message tokens
 * ```
 */
export function getMessageStats(messages: Message[]): {
  total: number
  user: number
  assistant: number
  system: number
} {
  return messages.reduce(
    (stats, msg) => {
      const count = countMessage(msg)
      stats.total += count

      switch (msg.role) {
        case 'user':
          stats.user += count
          break
        case 'assistant':
          stats.assistant += count
          break
        case 'system':
          stats.system += count
          break
      }

      return stats
    },
    { total: 0, user: 0, assistant: 0, system: 0 }
  )
}
