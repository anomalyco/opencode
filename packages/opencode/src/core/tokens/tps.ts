export const DEFAULT_MIN_TPS_ELAPSED_MS = 250
export const DEFAULT_INCLUDE_REASONING = true

export interface TokenMetrics {
  output: number
  reasoning: number
}

export interface TimestampMetrics {
  created: number
  firstToken?: number
  completed?: number
}

export interface TPSResult {
  rate: number
  totalTokens: number
  elapsedMs: number
  isValid: boolean
}

export function totalGeneratedTokens(tokens: TokenMetrics, includeReasoning = DEFAULT_INCLUDE_REASONING): number {
  return tokens.output + (includeReasoning ? tokens.reasoning : 0)
}

export function isValidForTPS(msg: {
  summary?: boolean
  finish?: string | null
  tokens: TokenMetrics
  time: TimestampMetrics
  minElapsedMs?: number
}): boolean {
  if (msg.summary) return false
  if (!msg.finish) return false
  if (["tool-calls", "unknown", "error"].includes(msg.finish)) return false

  const totalTokens = totalGeneratedTokens(msg.tokens)
  if (totalTokens <= 0) return false

  if (msg.time.firstToken === undefined || msg.time.completed === undefined) return false

  const elapsedMs = msg.time.completed - msg.time.firstToken
  const minElapsedMs = msg.minElapsedMs ?? DEFAULT_MIN_TPS_ELAPSED_MS

  return elapsedMs >= minElapsedMs
}

export function calculateTPS(
  totalTokens: number,
  elapsedMs: number,
  minElapsedMs = DEFAULT_MIN_TPS_ELAPSED_MS,
): TPSResult | undefined {
  if (totalTokens <= 0) return undefined
  if (elapsedMs < minElapsedMs) return undefined

  const rate = totalTokens / (elapsedMs / 1000)
  if (!Number.isFinite(rate) || rate < 0) return undefined

  return {
    rate: Math.round(rate),
    totalTokens,
    elapsedMs,
    isValid: true,
  }
}

export function formatTPS(result: TPSResult): string {
  return `${result.rate.toLocaleString()} tok/s`
}

export function getMessageTPS(msg: {
  summary?: boolean
  finish?: string | null
  tokens: TokenMetrics
  time: TimestampMetrics
}): TPSResult | undefined {
  if (!isValidForTPS(msg)) return undefined

  const totalTokens = totalGeneratedTokens(msg.tokens)
  const elapsedMs = msg.time.completed! - msg.time.firstToken!

  return calculateTPS(totalTokens, elapsedMs)
}
