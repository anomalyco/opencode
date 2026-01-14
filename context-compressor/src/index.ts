/**
 * ============================================================================
 * @ai-context/compressor - Main Entry Point
 * ============================================================================
 *
 * Context compression library for AI code assistants.
 */

// Core types and utilities
export type {
  Message,
  MessageRole,
  MessagePart,
  PartType,
  ToolPart,
  ToolStatus,
  TokenUsage,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  BaseMessage,
  TextPart,
  FilePart,
  ReasoningPart,
  CompressionConfig,
  CompressionResult,
  CompressionStrategy,
  TruncateConfig,
  PruneConfig,
  SummarizeConfig,
  CompressMessagesOptions,
} from './core/types.js'

// Token estimation
export { estimate, countMessage, countMessages, getMessageStats } from './core/token.js'

// Overflow detection
export {
  isOverflow,
  calculateOverflow,
  getCompressionTarget,
  calculateEfficiency,
  predictNextSize,
} from './core/detector.js'

// Storage
export { MemoryStorage } from './storage/memory.js'
export { FileStorage } from './storage/file.js'
export type { StorageInterface } from './storage/interface.js'

// LLM Providers
export {
  createProvider,
  LLMProvider,
  OpenAIProvider,
  AnthropicProvider,
} from './providers/index.js'
export type {
  ProviderConfig,
  SummaryResult,
  OpenAIConfig,
  AnthropicConfig,
  ProviderType,
} from './providers/index.js'

// Strategies
export { truncate, calculateTargetCount } from './strategies/truncate.js'
export type { TruncateResult } from './strategies/truncate.js'

export { prune, countToolOutputs, estimatePruneSavings } from './strategies/prune.js'
export type { PruneResult } from './strategies/prune.js'

export {
  summarize,
  DEFAULT_SUMMARY_PROMPT,
  estimateSummaryCost,
  createContinuationPrompt,
} from './strategies/summarize.js'
export type { SummarizeResult } from './strategies/summarize.js'

// Main compressor
export { ContextCompressor } from './compressor.js'
import type { CompressionConfig } from './core/types.js'
import { ContextCompressor as ContextCompressorClass } from './compressor.js'
import type { StorageInterface } from './storage/interface.js'
import type { LLMProvider } from './providers/base.js'

/**
 * Create a compressor with default configuration
 *
 * @param config - Compression configuration
 * @param storage - Optional storage
 * @param provider - Optional LLM provider
 * @returns Configured compressor instance
 *
 * @example
 * ```ts
 * import { createCompressor, MemoryStorage, createProvider } from '@ai-context/compressor'
 *
 * const compressor = createCompressor(
 *   { maxTokens: 100000, outputReserve: 4000 },
 *   new MemoryStorage(),
 *   createProvider('openai', { apiKey: process.env.OPENAI_API_KEY! })
 * )
 * ```
 */
export function createCompressor(
  config: CompressionConfig,
  storage?: StorageInterface,
  provider?: LLMProvider
): ContextCompressorClass {
  return new ContextCompressorClass(config, storage, provider)
}

/**
 * Default compression configurations
 */
export const DefaultConfig = {
  /**
   * Conservative configuration - preserves more context
   */
  conservative: {
    maxTokens: 100000,
    outputReserve: 4000,
    truncate: { enabled: true, maxMessages: 100 },
    prune: { enabled: true, minimumSavings: 30000, protectRecent: 50000, protectedTools: ['skill', 'read'] },
    summarize: { enabled: true },
  } satisfies CompressionConfig,

  /**
   * Balanced configuration
   */
  balanced: {
    maxTokens: 100000,
    outputReserve: 4000,
    truncate: { enabled: true, maxMessages: 50 },
    prune: { enabled: true, minimumSavings: 20000, protectRecent: 40000, protectedTools: ['skill'] },
    summarize: { enabled: true },
  } satisfies CompressionConfig,

  /**
   * Aggressive configuration - maximizes compression
   */
  aggressive: {
    maxTokens: 100000,
    outputReserve: 4000,
    truncate: { enabled: true, maxMessages: 20 },
    prune: { enabled: true, minimumSavings: 10000, protectRecent: 20000, protectedTools: [] },
    summarize: { enabled: true, maxTokens: 500 },
  } satisfies CompressionConfig,
} as const
