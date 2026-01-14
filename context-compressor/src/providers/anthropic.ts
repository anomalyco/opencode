/**
 * ============================================================================
 * @ai-context/compressor - Anthropic Provider
 * ============================================================================
 *
 * Anthropic (Claude) API provider implementation.
 */

import type { Message } from '../core/types.js'
import { LLMProvider, type ProviderConfig, type SummaryResult } from './base.js'

/**
 * Anthropic provider configuration
 */
export interface AnthropicConfig extends ProviderConfig {
  /** Anthropic API key */
  apiKey: string
  /** Base URL (default: https://api.anthropic.com) */
  baseURL?: string
  /** Model name (default: claude-3-haiku-20240307) */
  model?: string
  /** API version (default: 2023-06-01) */
  version?: string
}

/**
 * Anthropic (Claude) API provider
 *
 * Uses the Anthropic Messages API for summarization.
 */
export class AnthropicProvider extends LLMProvider {
  readonly #config: AnthropicConfig
  readonly #version: string

  constructor(config: AnthropicConfig) {
    super(config)
    this.#config = config
    this.#version = config.version ?? '2023-06-01'
  }

  async summarize(messages: Message[], prompt: string): Promise<SummaryResult> {
    const baseURL = this.#config.baseURL ?? 'https://api.anthropic.com'
    const model = this.#config.model ?? 'claude-3-haiku-20240307'

    // Convert messages to Anthropic format
    const { system, apiMessages } = this.#convertMessages(messages, prompt)

    const response = await fetch(`${baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.#config.apiKey,
        'anthropic-version': this.#version,
      },
      body: JSON.stringify({
        model,
        system,
        messages: apiMessages,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
      usage?: { input_tokens: number; output_tokens: number }
    }

    const summary =
      data.content
        .filter((item): item is { type: string; text: string } => item.type === 'text')
        .map((item) => item.text)
        .join('\n') ?? 'No summary generated'

    const tokens = {
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
    }

    return { summary, tokens }
  }

  async countTokens(text: string): Promise<number> {
    // Use Claude's tokenization if available, otherwise estimate
    return Math.ceil(text.length / 4)
  }

  #convertMessages(messages: Message[], prompt: string): {
    system: string
    apiMessages: Array<{ role: string; content: string }>
  } {
    const apiMessages: Array<{ role: string; content: string }> = []
    let system = ''

    for (const msg of messages) {
      if (msg.role === 'system') {
        system += msg.content + '\n'
        continue
      }

      const content = this.#messageToString(msg)
      if (!content) continue

      const role = msg.role === 'user' ? 'user' : 'assistant'
      apiMessages.push({ role, content })
    }

    // Add summarization prompt as user message
    apiMessages.push({ role: 'user', content: prompt })

    return { system: system.trim(), apiMessages }
  }

  #messageToString(msg: Message): string {
    if (msg.role === 'user' || msg.role === 'system') {
      return msg.content
    }

    // For assistant messages, combine parts
    return msg.parts
      .map((part) => {
        switch (part.type) {
          case 'text':
            return part.content
          case 'tool':
            return part.compacted ? `[Tool ${part.name}: compacted]` : `[Tool ${part.name}: ${part.output?.slice(0, 100)}]`
          case 'file':
            return `[File: ${part.url}]`
          case 'reasoning':
            return `[Reasoning: ${part.content.slice(0, 100)}]`
        }
      })
      .join('\n')
  }
}
