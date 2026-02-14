// CIC (Combat Information Center) — Real-time metrics for adversarial AI environments
//
// Tracks latency, throughput, cost efficiency, and cache performance
// across model interactions. Named after naval combat information centers
// because when OpenAI is the Death Star, you need tactical awareness.

import type { AssistantMessage, Message, Part, TextPart, ReasoningPart } from "@weapon-ai/sdk/v2"

export interface CICMetrics {
  // Latency
  ttft: number | null // Time to first token (ms)
  duration: number | null // Total response time (ms)
  tokensPerSec: number | null // Output throughput

  // Tokens
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number

  // Efficiency
  cacheHitRate: number | null // % of input from cache
  costPerKToken: number | null // $/1k output tokens
  totalCost: number

  // Session aggregates
  messageCount: number
  avgTTFT: number | null
  avgTokensPerSec: number | null
  p95Duration: number | null
}

export interface CICMessageStats {
  ttft: number | null
  duration: number | null
  tokensPerSec: number | null
  cacheHitRate: number | null
}

/**
 * Calculate TTFT from parts - finds the earliest text/reasoning part start time
 */
export function calculateTTFT(
  message: AssistantMessage,
  parts: Part[]
): number | null {
  if (!message.time.created) return null

  const textParts = parts.filter(
    (p): p is TextPart | ReasoningPart =>
      (p.type === "text" || p.type === "reasoning") && !!p.time?.start
  )

  if (textParts.length === 0) return null

  const firstPartStart = Math.min(...textParts.map((p) => p.time!.start))
  const ttft = firstPartStart - message.time.created

  // Sanity check - TTFT should be positive and reasonable (< 60s)
  if (ttft < 0 || ttft > 60000) return null

  return ttft
}

/**
 * Calculate response duration
 */
export function calculateDuration(message: AssistantMessage): number | null {
  if (!message.time.created || !message.time.completed) return null
  const duration = message.time.completed - message.time.created
  if (duration < 0) return null
  return duration
}

/**
 * Calculate output tokens per second
 */
export function calculateTokensPerSec(message: AssistantMessage): number | null {
  const duration = calculateDuration(message)
  if (!duration || duration === 0) return null

  const outputTokens = message.tokens.output + message.tokens.reasoning
  if (outputTokens === 0) return null

  return (outputTokens / duration) * 1000 // tokens/sec
}

/**
 * Calculate cache hit rate (what % of "input" came from cache)
 */
export function calculateCacheHitRate(message: AssistantMessage): number | null {
  const totalInput = message.tokens.input + message.tokens.cache.read
  if (totalInput === 0) return null

  return (message.tokens.cache.read / totalInput) * 100
}

/**
 * Calculate cost per 1k output tokens
 */
export function calculateCostPerKToken(message: AssistantMessage): number | null {
  const outputTokens = message.tokens.output + message.tokens.reasoning
  if (outputTokens === 0 || message.cost === 0) return null

  return (message.cost / outputTokens) * 1000
}

/**
 * Get stats for a single message
 */
export function getMessageStats(
  message: AssistantMessage,
  parts: Part[]
): CICMessageStats {
  return {
    ttft: calculateTTFT(message, parts),
    duration: calculateDuration(message),
    tokensPerSec: calculateTokensPerSec(message),
    cacheHitRate: calculateCacheHitRate(message),
  }
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

/**
 * Calculate aggregate CIC metrics for a session
 */
export function calculateSessionMetrics(
  messages: Message[],
  parts: Record<string, Part[]>
): CICMetrics {
  const assistantMessages = messages.filter(
    (m): m is AssistantMessage => m.role === "assistant"
  )

  // Aggregate tokens
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let cacheRead = 0
  let cacheWrite = 0
  let totalCost = 0

  // Per-message stats for aggregation
  const ttfts: number[] = []
  const durations: number[] = []
  const tokenRates: number[] = []

  for (const msg of assistantMessages) {
    inputTokens += msg.tokens.input
    outputTokens += msg.tokens.output
    reasoningTokens += msg.tokens.reasoning
    cacheRead += msg.tokens.cache.read
    cacheWrite += msg.tokens.cache.write
    totalCost += msg.cost

    const msgParts = parts[msg.id] ?? []
    const stats = getMessageStats(msg, msgParts)

    if (stats.ttft !== null) ttfts.push(stats.ttft)
    if (stats.duration !== null) durations.push(stats.duration)
    if (stats.tokensPerSec !== null) tokenRates.push(stats.tokensPerSec)
  }

  const totalTokens = inputTokens + outputTokens + reasoningTokens + cacheRead + cacheWrite

  // Calculate session-level cache hit rate
  const totalInput = inputTokens + cacheRead
  const cacheHitRate = totalInput > 0 ? (cacheRead / totalInput) * 100 : null

  // Calculate cost per 1k tokens (total output)
  const totalOutput = outputTokens + reasoningTokens
  const costPerKToken = totalOutput > 0 ? (totalCost / totalOutput) * 1000 : null

  // Calculate averages
  const avgTTFT = ttfts.length > 0
    ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length
    : null

  const avgTokensPerSec = tokenRates.length > 0
    ? tokenRates.reduce((a, b) => a + b, 0) / tokenRates.length
    : null

  // P95 duration
  const sortedDurations = [...durations].sort((a, b) => a - b)
  const p95Duration = percentile(sortedDurations, 95)

  // Latest message stats for "current" display
  const lastAssistant = assistantMessages.at(-1)
  const lastParts = lastAssistant ? parts[lastAssistant.id] ?? [] : []
  const lastStats = lastAssistant
    ? getMessageStats(lastAssistant, lastParts)
    : { ttft: null, duration: null, tokensPerSec: null, cacheHitRate: null }

  return {
    // Current (last message)
    ttft: lastStats.ttft,
    duration: lastStats.duration,
    tokensPerSec: lastStats.tokensPerSec,

    // Tokens
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    totalTokens,

    // Efficiency
    cacheHitRate,
    costPerKToken,
    totalCost,

    // Session aggregates
    messageCount: assistantMessages.length,
    avgTTFT,
    avgTokensPerSec,
    p95Duration,
  }
}

/**
 * Format milliseconds for display
 */
export function formatMs(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Format tokens/sec for display
 */
export function formatTokenRate(rate: number | null): string {
  if (rate === null) return "—"
  return `${rate.toFixed(1)} tok/s`
}

/**
 * Format percentage for display
 */
export function formatPercent(pct: number | null): string {
  if (pct === null) return "—"
  return `${pct.toFixed(0)}%`
}

/**
 * Format cost for display
 */
export function formatCost(cost: number | null): string {
  if (cost === null) return "—"
  if (cost < 0.001) return "<$0.001"
  return `$${cost.toFixed(4)}`
}
