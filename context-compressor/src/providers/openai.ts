/**
 * ============================================================================
 * @ai-context/compressor - OpenAI Provider
 * ============================================================================
 *
 * OpenAI API provider implementation.
 */

import type { Message } from '../core/types.js'
import { LLMProvider, type ProviderConfig, type SummaryResult } from './base.js'

/**
 * OpenAI provider configuration
 */
export interface OpenAIConfig extends ProviderConfig {
  /** OpenAI API key */
  apiKey: string
  /** Base URL (default: https://api.openai.com/v1) */
  baseURL?: string
  /** Model name (default: gpt-4o-mini) */
  model?: string
  /** Organization ID */
  organization?: string
}

/**
 * OpenAI API provider
 *
 * Uses the OpenAI Chat Completions API for summarization.
 */
export class OpenAIProvider extends LLMProvider {
  readonly #config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    super(config)
    this.#config = config
  }

  async summarize(messages: Message[], prompt: string): Promise<SummaryResult> {
    const baseURL = this.#config.baseURL ?? 'https://api.openai.com/v1'
    const model = this.#config.model ?? 'gpt-4o-mini'

    // Convert messages to OpenAI format
    const apiMessages = this.#convertMessages(messages, prompt)

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#config.apiKey}`,
        ...(this.#config.organization && { 'OpenAI-Organization': this.#config.organization }),
      },
      body: JSON.stringify({
        model,
        messages: apiMessages,
        max_tokens: 2000,
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    const summary = data.choices[0]?.message?.content ?? 'No summary generated'
    const tokens = {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    }

    return { summary, tokens }
  }

  async countTokens(text: string): Promise<number> {
    // Use OpenAI's tiktoken API if available, otherwise estimate
    // For now, use simple character-based estimation
    return Math.ceil(text.length / 4)
  }

  #convertMessages(messages: Message[], prompt: string): Array<{
    role: string
    content: string
  }> {
    const result: Array<{ role: string; content: string }> = []

    // Add conversation messages
    for (const msg of messages) {
      const content = this.#messageToString(msg)
      if (!content) continue

      const role = msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : 'assistant'
      result.push({ role, content })
    }

    // Add summarization prompt
    result.push({ role: 'user', content: prompt })

    return result
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
