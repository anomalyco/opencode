/**
 * ============================================================================
 * @ai-context/compressor - Provider Factory
 * ============================================================================
 *
 * Factory function for creating LLM providers.
 */

import type { ProviderConfig } from './base.js'
import { LLMProvider } from './base.js'
import { AnthropicProvider, type AnthropicConfig } from './anthropic.js'
import { OpenAIProvider, type OpenAIConfig } from './openai.js'

/**
 * Supported provider types
 */
export type ProviderType = 'openai' | 'anthropic' | 'custom'

/**
 * Create an LLM provider from configuration
 *
 * @param type - Provider type or custom instance
 * @param config - Provider configuration
 * @returns LLM provider instance
 *
 * @example
 * ```ts
 * // OpenAI
 * const openai = createProvider('openai', { apiKey: 'sk-...' })
 *
 * // Anthropic
 * const anthropic = createProvider('anthropic', { apiKey: 'sk-ant-...' })
 *
 * // Custom
 * class CustomProvider extends LLMProvider { ... }
 * const custom = createProvider('custom', new CustomProvider(config))
 * ```
 */
export function createProvider(
  type: 'openai',
  config: OpenAIConfig
): OpenAIProvider
export function createProvider(
  type: 'anthropic',
  config: AnthropicConfig
): AnthropicProvider
export function createProvider(
  type: 'custom',
  provider: LLMProvider
): LLMProvider
export function createProvider(
  type: ProviderType | string,
  configOrProvider: ProviderConfig | LLMProvider
): LLMProvider {
  if (type === 'custom') {
    return configOrProvider as LLMProvider
  }

  const config = configOrProvider as ProviderConfig

  switch (type) {
    case 'openai':
      return new OpenAIProvider(config as OpenAIConfig)
    case 'anthropic':
      return new AnthropicProvider(config as AnthropicConfig)
    default:
      throw new Error(`Unknown provider type: ${type}`)
  }
}

// Re-export all providers and base class
export { LLMProvider } from './base.js'
export type { ProviderConfig, SummaryResult } from './base.js'
export { OpenAIProvider } from './openai.js'
export type { OpenAIConfig } from './openai.js'
export { AnthropicProvider } from './anthropic.js'
export type { AnthropicConfig } from './anthropic.js'
