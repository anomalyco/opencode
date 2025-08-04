/**
 * Calculate current session context usage (matching TUI logic)
 * This shows current conversation context, not cumulative usage
 */

import db from "@/db"
import { messages } from "@/db/schema"
import { eq, desc } from "drizzle-orm"

export interface SessionContext {
  currentTokens: number // Current context window usage
  totalCost: number // Cumulative cost
  contextWindow: number // Model's context window limit
}

/**
 * Calculate session context matching TUI logic:
 * - currentTokens: Latest assistant message tokens (current context)
 * - totalCost: Sum of all message costs
 * - contextWindow: Model limit (TODO: get from model data)
 */
export async function calculateSessionContext(sessionId: string): Promise<SessionContext> {
  // Get all messages for this session, ordered by creation time
  const sessionMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.timeCreated))

  let currentTokens = 0
  let totalCost = 0

  // Calculate total cost (cumulative)
  for (const message of sessionMessages) {
    totalCost += message.cost || 0
  }

  // Find current context tokens (latest assistant message)
  // This matches TUI logic: tokens = latest assistant message tokens
  for (const message of sessionMessages) {
    if (message.role === "assistant") {
      // If this assistant message has output tokens, use its total
      if ((message.tokensOutput || 0) > 0) {
        if (message.isSummary) {
          // For summary messages, only count output tokens
          currentTokens = message.tokensOutput || 0
        } else {
          // For regular messages, count all token types
          currentTokens =
            (message.tokensInput || 0) +
            (message.tokensOutput || 0) +
            (message.tokensReasoning || 0) +
            (message.tokensCacheRead || 0) +
            (message.tokensCacheWrite || 0)
        }
        break // Use the latest assistant message only
      }
    }
  }

  return {
    currentTokens,
    totalCost,
    contextWindow: 200000, // Common context window size (Claude, GPT-4, etc.)
  }
}

/**
 * Format session context for display (matching TUI format)
 */
export function formatSessionContext(context: SessionContext, isSubscriptionModel: boolean = false): string {
  if (context.currentTokens === 0 && context.totalCost === 0) {
    return "No usage yet"
  }

  // Format tokens in human-readable format
  let formattedTokens: string
  if (context.currentTokens >= 1_000_000) {
    formattedTokens = `${(context.currentTokens / 1_000_000).toFixed(1)}M`
  } else if (context.currentTokens >= 1_000) {
    formattedTokens = `${(context.currentTokens / 1_000).toFixed(1)}K`
  } else {
    formattedTokens = context.currentTokens.toString()
  }

  // Remove .0 suffix
  formattedTokens = formattedTokens.replace(".0K", "K").replace(".0M", "M")

  // Calculate percentage of context window used
  const percentage = context.contextWindow > 0 ? Math.round((context.currentTokens / context.contextWindow) * 100) : 0

  if (isSubscriptionModel) {
    return `${formattedTokens}/${percentage}%`
  }

  const formattedCost = `$${context.totalCost.toFixed(2)}`
  return `${formattedTokens}/${percentage}% (${formattedCost})`
}
