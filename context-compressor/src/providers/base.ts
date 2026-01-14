/**
 * ============================================================================
 * @ai-context/compressor - LLM Provider Base
 * ============================================================================
 *
 * Abstract base class for LLM providers.
 */

import type { Message } from '../core/types.js'

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** API key or credentials */
  apiKey?: string
  /** Base URL for API */
  baseURL?: string
  /** Model name */
  model?: string
  /** Additional options */
  [key: string]: unknown
}

/**
 * Summary result
 */
export interface SummaryResult {
  /** Generated summary text */
  summary: string
  /** Tokens used for generation */
  tokens: {
    input: number
    output: number
  }
}

/**
 * Abstract LLM provider base class
 *
 * Extend this class to implement support for different LLM providers.
 */
export abstract class LLMProvider {
  protected constructor(
    protected readonly config: ProviderConfig
  ) {}

  /**
   * Generate a summary of messages
   *
   * @param messages - Messages to summarize
   * @param prompt - Custom prompt for summarization
   * @returns Generated summary
   */
  abstract summarize(messages: Message[], prompt: string): Promise<SummaryResult>

  /**
   * Count tokens in text
   *
   * @param text - Text to count
   * @returns Token count
   */
  abstract countTokens(text: string): Promise<number>

  /**
   * Get model name
   */
  getModel(): string {
    return this.config.model ?? 'default'
  }
}
