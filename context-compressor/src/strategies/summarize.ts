/**
 * ============================================================================
 * @ai-context/compressor - Summarize Strategy
 * ============================================================================
 *
 * AI-powered summarization strategy using LLM providers.
 */

import type { Message, SummarizeConfig } from '../core/types.js'
import type { LLMProvider } from '../providers/base.js'
import { estimate } from '../core/token.js'

/**
 * Default summarization prompt
 */
export const DEFAULT_SUMMARY_PROMPT = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation,
including what we did, what we're doing, which files we're working on,
and what we're going to do next considering the new session will not have access to our conversation.`

/**
 * Summarize strategy result
 */
export interface SummarizeResult {
  /** Messages with summary added */
  messages: Message[]
  /** Generated summary */
  summary: string
  /** Tokens removed (original messages) */
  tokensRemoved: number
  /** Tokens added (summary message) */
  tokensAdded: number
  /** Net tokens saved */
  tokensSaved: number
}

/**
 * Apply summarize strategy
 *
 * Uses an LLM provider to generate a summary of the conversation.
 * The summary is added as a special assistant message.
 *
 * @param messages - Messages to summarize
 * @param config - Summarize configuration
 * @param provider - LLM provider
 * @param prompt - Custom prompt (optional)
 * @returns Summarization result
 *
 * @example
 * ```ts
 * const result = await summarize(messages, { enabled: true }, provider)
 * console.log(`Summary: ${result.summary}`)
 * console.log(`Saved ${result.tokensSaved} tokens`)
 * ```
 */
export async function summarize(
  messages: Message[],
  config: SummarizeConfig,
  provider: LLMProvider,
  prompt: string = DEFAULT_SUMMARY_PROMPT
): Promise<SummarizeResult> {
  if (!config.enabled) {
    return {
      messages: messages.slice(),
      summary: '',
      tokensRemoved: 0,
      tokensAdded: 0,
      tokensSaved: 0,
    }
  }

  // Count original tokens
  const originalTokens = messages.reduce((sum, msg) => {
    if (msg.role === 'user' || msg.role === 'system') {
      return sum + estimate(msg.content)
    }
    return sum + estimate(JSON.stringify(msg.parts))
  }, 0)

  // Generate summary using provider
  const { summary, tokens } = await provider.summarize(messages, prompt)

  // Create summary message
  const summaryMsg: Message = {
    id: `summary-${Date.now()}`,
    role: 'assistant',
    timestamp: Date.now(),
    parts: [
      {
        type: 'text',
        content: summary,
      },
    ],
    summary: true,
    tokens: {
      input: tokens.input,
      output: tokens.output,
    },
  }

  // Return only the summary message (replaces all previous messages)
  const result = [summaryMsg]
  const tokensRemoved = originalTokens
  const tokensAdded = estimate(summary)

  return {
    messages: result,
    summary,
    tokensRemoved,
    tokensAdded,
    tokensSaved: tokensRemoved - tokensAdded,
  }
}

/**
 * Estimate summary cost without generating
 *
 * @param messages - Messages to summarize
 * @param provider - LLM provider
 * @returns Estimated input tokens for summarization
 */
export async function estimateSummaryCost(
  messages: Message[],
  provider: LLMProvider
): Promise<number> {
  // Estimate by serializing messages
  const text = JSON.stringify(messages)
  return await provider.countTokens(text)
}

/**
 * Create a continuation prompt for after summary
 *
 * @returns Continuation prompt
 */
export function createContinuationPrompt(): string {
  return 'Continue if you have next steps'
}
