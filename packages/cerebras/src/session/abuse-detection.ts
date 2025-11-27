import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"

export namespace AbuseDetection {
  const log = Log.create({ service: "abuse-detection" })

  // Configurable thresholds
  export const IDENTICAL_PROMPT_THRESHOLD = 3 // Same prompt repeated X times
  export const BURST_REQUEST_THRESHOLD = 10 // Requests per second
  export const BURST_WINDOW_MS = 1000 // 1 second window
  export const LOPSIDED_RATIO_THRESHOLD = 150 // 3000 input / 20 output = 150:1
  export const MIN_OUTPUT_TOKENS = 20 // Minimum output to check ratio
  export const PROMPT_GROWTH_THRESHOLD = 2.0 // 2x growth between messages
  export const MAX_PROMPT_GROWTH_STREAK = 3 // Consecutive growth violations

  export type Pattern = "identical_prompts" | "burst_requests" | "lopsided_tokens" | "prompt_size_growth" | "none"

  export type DetectionResult = {
    pattern: Pattern
    severity: "warning" | "critical"
    message: string
    suggestion: string
    metadata?: Record<string, any>
  }

  type SessionState = {
    prompts: Array<{ text: string; timestamp: number; tokenCount: number }>
    requestTimestamps: number[]
    tokenHistory: Array<{ input: number; output: number; timestamp: number }>
    lastPromptSize: number
    growthStreak: number
  }

  const sessionStates = new Map<string, SessionState>()

  /**
   * Get or create session state for tracking
   */
  function getSessionState(sessionID: string): SessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        prompts: [],
        requestTimestamps: [],
        tokenHistory: [],
        lastPromptSize: 0,
        growthStreak: 0,
      })
    }
    return sessionStates.get(sessionID)!
  }

  /**
   * Clean up old session states (prevent memory leak)
   */
  export function cleanup(sessionID: string) {
    sessionStates.delete(sessionID)
  }

  /**
   * Check for identical prompts (infinite loop detection)
   */
  function detectIdenticalPrompts(state: SessionState, newPrompt: string): DetectionResult | null {
    const recentPrompts = state.prompts.slice(-IDENTICAL_PROMPT_THRESHOLD)
    const identicalCount = recentPrompts.filter((p) => p.text === newPrompt).length

    if (identicalCount >= IDENTICAL_PROMPT_THRESHOLD) {
      return {
        pattern: "identical_prompts",
        severity: "critical",
        message: `Detected ${identicalCount} identical prompts in a row. This may indicate an infinite loop.`,
        suggestion: "Check your code for infinite loops. Consider adding exit conditions or varying your prompts.",
        metadata: {
          prompt: newPrompt.slice(0, 100) + "...",
          count: identicalCount,
        },
      }
    }

    return null
  }

  /**
   * Check for burst requests (high-frequency attack)
   */
  function detectBurstRequests(state: SessionState): DetectionResult | null {
    const now = Date.now()
    const recentRequests = state.requestTimestamps.filter((ts) => now - ts < BURST_WINDOW_MS)

    if (recentRequests.length >= BURST_REQUEST_THRESHOLD) {
      const rps = recentRequests.length / (BURST_WINDOW_MS / 1000)
      return {
        pattern: "burst_requests",
        severity: "warning",
        message: `Detected ${recentRequests.length} requests in ${BURST_WINDOW_MS}ms (${rps.toFixed(1)} req/s).`,
        suggestion:
          "Consider batching your requests or adding delays between calls. High-frequency requests may trigger rate limits.",
        metadata: {
          requestsPerSecond: rps,
          count: recentRequests.length,
        },
      }
    }

    return null
  }

  /**
   * Check for lopsided token usage (high input, low output)
   */
  function detectLopsidedTokens(inputTokens: number, outputTokens: number): DetectionResult | null {
    if (outputTokens < MIN_OUTPUT_TOKENS) {
      // Too few tokens to make a judgment
      return null
    }

    const ratio = inputTokens / outputTokens

    if (ratio >= LOPSIDED_RATIO_THRESHOLD) {
      return {
        pattern: "lopsided_tokens",
        severity: "warning",
        message: `Lopsided token usage detected: ${inputTokens} input / ${outputTokens} output (${ratio.toFixed(1)}:1 ratio).`,
        suggestion:
          "You're sending large inputs but getting minimal outputs. Consider summarizing inputs, using smaller context, or checking if your prompts are well-formed.",
        metadata: {
          inputTokens,
          outputTokens,
          ratio: ratio.toFixed(2),
        },
      }
    }

    return null
  }

  /**
   * Check for uncontrollable prompt size growth
   */
  function detectPromptGrowth(state: SessionState, newPromptSize: number): DetectionResult | null {
    if (state.lastPromptSize === 0) {
      // First prompt, no comparison
      state.lastPromptSize = newPromptSize
      return null
    }

    const growthRatio = newPromptSize / state.lastPromptSize

    if (growthRatio >= PROMPT_GROWTH_THRESHOLD) {
      state.growthStreak++
    } else {
      state.growthStreak = 0
    }

    state.lastPromptSize = newPromptSize

    if (state.growthStreak >= MAX_PROMPT_GROWTH_STREAK) {
      return {
        pattern: "prompt_size_growth",
        severity: "critical",
        message: `Prompt size is growing uncontrollably (${state.growthStreak} consecutive increases, ${growthRatio.toFixed(1)}x growth).`,
        suggestion:
          "Your prompts are growing exponentially. Check for context accumulation bugs or implement prompt compaction.",
        metadata: {
          currentSize: newPromptSize,
          previousSize: state.lastPromptSize,
          growthRatio: growthRatio.toFixed(2),
          streak: state.growthStreak,
        },
      }
    }

    return null
  }

  /**
   * Main detection function - checks all patterns
   */
  export function detect(input: {
    sessionID: string
    prompt: string
    promptTokenCount: number
    inputTokens?: number
    outputTokens?: number
  }): DetectionResult | null {
    const state = getSessionState(input.sessionID)
    const now = Date.now()

    // Record this request
    state.requestTimestamps.push(now)
    state.prompts.push({
      text: input.prompt,
      timestamp: now,
      tokenCount: input.promptTokenCount,
    })

    if (input.inputTokens && input.outputTokens) {
      state.tokenHistory.push({
        input: input.inputTokens,
        output: input.outputTokens,
        timestamp: now,
      })
    }

    // Clean up old data (keep last 1 minute only)
    const cutoff = now - 60_000
    state.requestTimestamps = state.requestTimestamps.filter((ts) => ts > cutoff)
    state.prompts = state.prompts.filter((p) => p.timestamp > cutoff)
    state.tokenHistory = state.tokenHistory.filter((t) => t.timestamp > cutoff)

    // Run all detection checks (in order of severity)
    const checks = [
      () => detectIdenticalPrompts(state, input.prompt),
      () => detectPromptGrowth(state, input.promptTokenCount),
      () => detectBurstRequests(state),
      () =>
        input.inputTokens && input.outputTokens ? detectLopsidedTokens(input.inputTokens, input.outputTokens) : null,
    ]

    for (const check of checks) {
      const result = check()
      if (result) {
        log.warn("abuse pattern detected", {
          sessionID: input.sessionID,
          pattern: result.pattern,
          severity: result.severity,
          metadata: result.metadata,
        })
        return result
      }
    }

    return null
  }

  /**
   * Get statistics for a session
   */
  export function getStats(sessionID: string) {
    const state = sessionStates.get(sessionID)
    if (!state) {
      return null
    }

    const now = Date.now()
    const recentRequests = state.requestTimestamps.filter((ts) => now - ts < 60_000)

    return {
      totalRequests: state.requestTimestamps.length,
      requestsLastMinute: recentRequests.length,
      averagePromptSize:
        state.prompts.length > 0 ? state.prompts.reduce((sum, p) => sum + p.tokenCount, 0) / state.prompts.length : 0,
      tokenHistory: state.tokenHistory.slice(-10), // Last 10
    }
  }
}
