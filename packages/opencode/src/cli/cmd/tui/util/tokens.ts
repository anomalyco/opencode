export const MIN_TOKENS_PER_SECOND_ELAPSED_MS = 250

export function totalGeneratedTokens(tokens: { output: number; reasoning: number }) {
  return tokens.output + tokens.reasoning
}

export function isValidForTokensPerSecond(msg: {
  summary?: boolean
  finish?: string | null
  tokens: { output: number; reasoning: number }
  time: { completed?: number; firstToken?: number }
}): boolean {
  if (msg.summary) return false
  if (!msg.finish || ["tool-calls", "unknown"].includes(msg.finish)) return false
  const totalTokens = totalGeneratedTokens(msg.tokens)
  if (totalTokens <= 0) return false
  if (msg.time.completed === undefined || msg.time.firstToken === undefined) return false
  const elapsedMs = msg.time.completed - msg.time.firstToken
  return elapsedMs >= MIN_TOKENS_PER_SECOND_ELAPSED_MS
}

export function calculateTokensPerSecond(input: {
  totalTokens: number
  elapsedMs: number
  minElapsedMs?: number
}): number | undefined {
  if (input.totalTokens <= 0) return undefined
  const minElapsedMs = input.minElapsedMs ?? MIN_TOKENS_PER_SECOND_ELAPSED_MS
  if (input.elapsedMs < minElapsedMs) return undefined
  const rate = input.totalTokens / (input.elapsedMs / 1000)
  if (!Number.isFinite(rate)) return undefined
  return Math.round(rate)
}

