/**
 * ============================================================================
 * @ai-context/compressor - Context Compressor
 * ============================================================================
 *
 * Main context compressor class that orchestrates all compression strategies.
 */

import type {
  CompressionConfig,
  CompressionResult,
  CompressMessagesOptions,
  Message,
} from './core/types.js'
import { isOverflow, calculateOverflow } from './core/detector.js'
import { countMessages } from './core/token.js'
import type { StorageInterface } from './storage/interface.js'
import type { LLMProvider } from './providers/base.js'
import { truncate, type TruncateResult } from './strategies/truncate.js'
import { prune, estimatePruneSavings, type PruneResult } from './strategies/prune.js'
import { summarize, DEFAULT_SUMMARY_PROMPT, type SummarizeResult } from './strategies/summarize.js'

/**
 * Main context compressor class
 *
 * Orchestrates layered compression: truncate → prune → summarize
 */
export class ContextCompressor {
  constructor(
    private readonly config: CompressionConfig,
    private readonly storage?: StorageInterface,
    private readonly provider?: LLMProvider
  ) {}

  /**
   * Compress messages for a session
   *
   * @param sessionId - Session ID to compress
   * @returns Compression result
   *
   * @example
   * ```ts
   * const result = await compressor.compress('session-123')
   * console.log(`Strategy: ${result.strategy}`)
   * console.log(`Saved: ${result.tokensSaved} tokens`)
   * ```
   */
  async compress(sessionId: string): Promise<CompressionResult> {
    if (!this.storage) {
      throw new Error('Storage required for session compression')
    }

    const messages = await this.storage.getMessages(sessionId)
    const result = await this.compressMessages(messages, { sessionId })
    return result.result
  }

  /**
   * Compress a message array directly
   *
   * @param messages - Messages to compress
   * @param options - Optional overrides
   * @returns Compressed messages and result
   *
   * @example
   * ```ts
   * const { messages, result } = await compressor.compressMessages(messages)
   * ```
   */
  async compressMessages(
    messages: Message[],
    options?: CompressMessagesOptions & { sessionId?: string }
  ): Promise<{
    messages: Message[]
    result: CompressionResult
  }> {
    // Merge options with config
    const truncateConfig = options?.truncate ?? this.config.truncate
    const pruneConfig = options?.prune ?? this.config.prune
    const summarizeConfig = options?.summarize ?? this.config.summarize

    // Check if overflow
    if (!isOverflow(messages, this.config)) {
      return {
        messages,
        result: {
          strategy: 'none',
          tokensSaved: 0,
          messagesRemoved: 0,
        },
      }
    }

    let current = messages
    let result: CompressionResult = {
      strategy: 'none',
      tokensSaved: 0,
      messagesRemoved: 0,
    }

    // Strategy 1: Truncate
    if (truncateConfig?.enabled) {
      const truncateResult: TruncateResult = await truncate(current, truncateConfig)

      if (truncateResult.tokensSaved > 0) {
        current = truncateResult.messages
        result = {
          strategy: 'truncate',
          tokensSaved: truncateResult.tokensSaved,
          messagesRemoved: truncateResult.originalCount - truncateResult.newCount,
        }

        // Check if still overflowing
        if (!isOverflow(current, this.config)) {
          await this.#saveIfNeeded(options?.sessionId, current)
          return { messages: current, result }
        }
      }
    }

    // Strategy 2: Prune
    if (pruneConfig?.enabled) {
      const pruneResult: PruneResult = await prune(current, pruneConfig)

      if (pruneResult.tokensSaved > pruneConfig.minimumSavings) {
        current = pruneResult.messages
        result = {
          strategy: 'prune',
          tokensSaved: pruneResult.tokensSaved,
          messagesRemoved: messages.length - current.length,
        }

        // Check if still overflowing
        if (!isOverflow(current, this.config)) {
          await this.#saveIfNeeded(options?.sessionId, current)
          return { messages: current, result }
        }
      }
    }

    // Strategy 3: Summarize
    if (summarizeConfig?.enabled && this.provider) {
      const summarizeResult: SummarizeResult = await summarize(
        current,
        summarizeConfig,
        this.provider,
        DEFAULT_SUMMARY_PROMPT
      )

      current = summarizeResult.messages
      result = {
        strategy: 'summarize',
        tokensSaved: summarizeResult.tokensSaved,
        messagesRemoved: messages.length - current.length,
        summary: summarizeResult.summary,
      }

      await this.#saveIfNeeded(options?.sessionId, current)
      return { messages: current, result }
    }

    // No strategy worked or all disabled
    await this.#saveIfNeeded(options?.sessionId, current)
    return { messages: current, result }
  }

  /**
   * Get compression statistics
   *
   * @param messages - Messages to analyze
   * @returns Compression statistics
   */
  getStats(messages: Message[]): {
    total: number
    overflow: number
    percentage: number
  } {
    const stats = calculateOverflow(messages, this.config)
    const usable = this.config.maxTokens - this.config.outputReserve
    return {
      total: stats.total,
      overflow: stats.overflow,
      percentage: Math.round((stats.total / usable) * 100),
    }
  }

  /**
   * Estimate potential savings for each strategy
   *
   * @param messages - Messages to analyze
   * @returns Estimated savings by strategy
   */
  estimateSavings(messages: Message[]): {
    truncate: number
    prune: number
    summarize: number
  } {
    const original = countMessages(messages)

    // Truncate savings
    let truncateSavings = 0
    if (this.config.truncate?.enabled) {
      const keepCount = Math.min(this.config.truncate.maxMessages, messages.length)
      const removed = messages.length - keepCount
      truncateSavings = countMessages(messages.slice(0, removed))
    }

    // Prune savings
    let pruneSavings = 0
    if (this.config.prune?.enabled) {
      pruneSavings = estimatePruneSavings(messages, this.config.prune)
    }

    // Summarize savings (estimate as 90% reduction)
    let summarizeSavings = 0
    if (this.config.summarize?.enabled) {
      summarizeSavings = Math.round(original * 0.9)
    }

    return {
      truncate: truncateSavings,
      prune: pruneSavings,
      summarize: summarizeSavings,
    }
  }

  async #saveIfNeeded(sessionId: string | undefined, messages: Message[]): Promise<void> {
    if (this.storage && sessionId) {
      // Clear and replace
      await this.storage.clear(sessionId)
      for (const msg of messages) {
        await this.storage.addMessage(sessionId, msg)
      }
    }
  }
}
