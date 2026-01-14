/**
 * ============================================================================
 * Custom Provider Example
 * ============================================================================
 *
 * Demonstrates how to create a custom LLM provider.
 */

import type { Message } from '../src/core/types.js'
import { LLMProvider, type ProviderConfig, type SummaryResult } from '../src/providers/base.js'

/**
 * Custom provider configuration
 */
interface CustomConfig extends ProviderConfig {
  baseURL: string
  apiKey: string
  model: string
}

/**
 * Custom LLM provider example
 *
 * This example shows how to extend the base LLMProvider class
 * to support a custom API.
 */
export class CustomProvider extends LLMProvider {
  readonly #config: CustomConfig

  constructor(config: CustomConfig) {
    super(config)
    this.#config = config
  }

  /**
   * Generate a summary using the custom API
   */
  async summarize(messages: Message[], prompt: string): Promise<SummaryResult> {
    // Convert messages to your API's format
    const apiMessages = this.#convertMessages(messages)

    const response = await fetch(`${this.#config.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.#config.model,
        messages: [...apiMessages, { role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      throw new Error(`Custom API error: ${response.status}`)
    }

    const data = await response.json()
    const summary = data.choices[0]?.message?.content ?? 'No summary'
    const tokens = {
      input: data.usage?.prompt_tokens ?? this.#estimateInput(messages),
      output: data.usage?.completion_tokens ?? this.#estimateOutput(summary),
    }

    return { summary, tokens }
  }

  /**
   * Count tokens in text
   */
  async countTokens(text: string): Promise<number> {
    // Simple estimation - replace with your tokenizer
    return Math.ceil(text.length / 4)
  }

  #convertMessages(messages: Message[]): Array<{ role: string; content: string }> {
    const result: Array<{ role: string; content: string }> = []

    for (const msg of messages) {
      const content = this.#messageToString(msg)
      if (!content) continue

      const role = msg.role === 'system' ? 'system' : msg.role === 'user' ? 'user' : 'assistant'
      result.push({ role, content })
    }

    return result
  }

  #messageToString(msg: Message): string {
    if (msg.role === 'user' || msg.role === 'system') {
      return msg.content
    }

    return msg.parts
      .map((part) => {
        switch (part.type) {
          case 'text':
            return part.content
          case 'tool':
            return `[Tool: ${part.name}]`
          case 'file':
            return `[File: ${part.url}]`
          case 'reasoning':
            return `[Reasoning]`
        }
      })
      .join('\n')
  }

  #estimateInput(messages: Message[]): number {
    return Math.ceil(JSON.stringify(messages).length / 4)
  }

  #estimateOutput(text: string): number {
    return Math.ceil(text.length / 4)
  }
}

// ============================================================================
// Usage Example
// ============================================================================

async function example() {
  const messages: Message[] = [
    {
      id: '1',
      role: 'user',
      timestamp: Date.now(),
      content: 'Help me write a function',
    },
    {
      id: '2',
      role: 'assistant',
      timestamp: Date.now(),
      parts: [{ type: 'text', content: 'Sure! Here is a function...' }],
    },
  ]

  // Create custom provider
  const provider = new CustomProvider({
    baseURL: 'https://api.example.com',
    apiKey: 'your-api-key',
    model: 'custom-model-v1',
  })

  // Use it with the compressor
  const { ContextCompressor } = await import('../src/index.js')
  const compressor = new ContextCompressor(
    {
      maxTokens: 100000,
      outputReserve: 4000,
      summarize: { enabled: true },
    },
    undefined,
    provider
  )

  const { result } = await compressor.compressMessages(messages)
  console.log('Summary:', result.summary)
}

// Run example
// example().catch(console.error)

export { CustomProvider }
