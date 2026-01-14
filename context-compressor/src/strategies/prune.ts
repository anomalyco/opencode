/**
 * ============================================================================
 * @ai-context/compressor - Prune Strategy
 * ============================================================================
 *
 * Intelligent pruning strategy - removes old tool outputs while preserving context.
 */

import type { Message, PruneConfig, ToolPart } from '../core/types.js'
import { estimate } from '../core/token.js'

/**
 * Prune strategy result
 */
export interface PruneResult {
  /** Pruned messages (with modifications) */
  messages: Message[]
  /** Tokens saved */
  tokensSaved: number
  /** Tools pruned */
  toolsPruned: number
}

/**
 * Apply prune strategy
 *
 * Removes old tool outputs while preserving:
 * - Recent 2 turns of conversation
 * - Recent N tokens (configurable)
 * - Protected tools
 *
 * @param messages - Messages to prune
 * @param config - Prune configuration
 * @returns Pruning result
 *
 * @example
 * ```ts
 * const result = await prune(messages, {
 *   enabled: true,
 *   minimumSavings: 20000,
 *   protectRecent: 40000,
 *   protectedTools: ['skill', 'read']
 * })
 * console.log(`Pruned ${result.toolsPruned} tools, saved ${result.tokensSaved} tokens`)
 * ```
 */
export async function prune(
  messages: Message[],
  config: PruneConfig
): Promise<PruneResult> {
  if (!config.enabled) {
    return {
      messages: messages.map((msg) =>
        msg.role === 'assistant'
          ? { ...msg, parts: msg.parts?.slice() ?? [] }
          : { ...msg }
      ),
      tokensSaved: 0,
      toolsPruned: 0,
    }
  }

  // Deep clone messages to avoid mutations
  const cloned = messages.map((msg) =>
    msg.role === 'assistant'
      ? { ...msg, parts: msg.parts?.slice() ?? [] }
      : { ...msg }
  )

  let tokensSaved = 0
  let toolsPruned = 0
  let total = 0 // Running token count from newest to oldest
  let turns = 0 // Conversation turns counted

  // Iterate from newest to oldest
  for (let i = cloned.length - 1; i >= 0; i--) {
    const msg = cloned[i]!

    // Count user messages as turns
    if (msg.role === 'user') {
      turns++
    }

    // Always keep the most recent 2 turns
    if (turns <= 2) {
      // Still count tokens but don't prune
      if (msg.role === 'assistant') {
        for (const part of msg.parts) {
          if (part.type === 'tool' && part.status === 'completed' && part.output && !part.compacted) {
            total += estimate(part.output)
          }
        }
      }
      continue
    }

    // Stop at summary messages
    if (msg.role === 'assistant' && msg.summary) {
      break
    }

    // Check each tool part
    if (msg.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type !== 'tool') continue
        if (part.status !== 'completed') continue
        if (!part.output) continue
        if (part.compacted) continue

        // Skip protected tools
        if (config.protectedTools.includes(part.name)) {
          total += estimate(part.output)
          continue
        }

        const partTokens = estimate(part.output)
        total += partTokens

        // If we're past the protection threshold, prune this tool
        if (total > config.protectRecent) {
          const toolPart = part as ToolPart
          toolPart.output = '[Content cleared by compaction]'
          toolPart.compacted = Date.now()
          tokensSaved += partTokens
          toolsPruned++
        }
      }
    }
  }

  // Only return if we saved enough tokens
  if (tokensSaved < config.minimumSavings) {
    // Revert changes
    return {
      messages: messages.map((msg) =>
        msg.role === 'assistant'
          ? { ...msg, parts: msg.parts?.slice() ?? [] }
          : { ...msg }
      ),
      tokensSaved: 0,
      toolsPruned: 0,
    }
  }

  return {
    messages: cloned,
    tokensSaved,
    toolsPruned,
  }
}

/**
 * Count tool outputs in messages
 *
 * @param messages - Messages to analyze
 * @returns Count of tool outputs
 */
export function countToolOutputs(messages: Message[]): number {
  let count = 0
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type === 'tool' && part.output && !part.compacted) {
          count++
        }
      }
    }
  }
  return count
}

/**
 * Estimate prune savings without applying
 *
 * @param messages - Messages to analyze
 * @param config - Prune configuration
 * @returns Estimated tokens that would be saved
 */
export function estimatePruneSavings(messages: Message[], config: PruneConfig): number {
  let total = 0
  let savings = 0
  let turns = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!

    if (msg.role === 'user') turns++
    if (turns <= 2) continue
    if (msg.role === 'assistant' && msg.summary) break

    if (msg.role === 'assistant') {
      for (const part of msg.parts) {
        if (part.type !== 'tool') continue
        if (part.status !== 'completed') continue
        if (!part.output) continue
        if (part.compacted) continue
        if (config.protectedTools.includes(part.name)) {
          total += estimate(part.output)
          continue
        }

        const tokens = estimate(part.output)
        total += tokens
        if (total > config.protectRecent) {
          savings += tokens
        }
      }
    }
  }

  return savings
}
