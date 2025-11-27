import { Log } from "../util/log"
import { Config } from "../config/config"
import { Bus } from "../bus"
import z from "zod"

export namespace TokenBudget {
  const log = Log.create({ service: "token-budget" })

  // Default limits (can be overridden in config)
  export const DEFAULT_SESSION_TOKEN_CAP = 1_000_000 // 1M tokens per session
  export const DEFAULT_WARNING_THRESHOLD = 0.8 // Warn at 80%
  export const DEFAULT_CRITICAL_THRESHOLD = 0.95 // Critical at 95%

  // Runtime configuration (loaded from config)
  let SESSION_TOKEN_CAP = DEFAULT_SESSION_TOKEN_CAP
  let WARNING_THRESHOLD = DEFAULT_WARNING_THRESHOLD
  let CRITICAL_THRESHOLD = DEFAULT_CRITICAL_THRESHOLD
  let ENABLED = true

  /**
   * Load configuration settings
   */
  async function loadConfig() {
    const config = await Config.get()
    const safety = config.safety?.token_budget

    if (!safety) return

    ENABLED = safety.enabled ?? true
    SESSION_TOKEN_CAP = safety.max_tokens_per_session ?? DEFAULT_SESSION_TOKEN_CAP
    WARNING_THRESHOLD = safety.warning_threshold ?? DEFAULT_WARNING_THRESHOLD
    CRITICAL_THRESHOLD = safety.critical_threshold ?? DEFAULT_CRITICAL_THRESHOLD

    log.info("config loaded", {
      enabled: ENABLED,
      sessionTokenCap: SESSION_TOKEN_CAP,
      warningThreshold: WARNING_THRESHOLD,
      criticalThreshold: CRITICAL_THRESHOLD,
    })
  }

  // Load config on module initialization
  loadConfig().catch((err) => {
    log.error("failed to load config, using defaults", { error: err })
  })

  type SessionUsage = {
    sessionID: string
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    startTime: number
    lastUpdate: number
  }

  const sessionUsage = new Map<string, SessionUsage>()

  /**
   * Event fired when token budget reaches warning/critical threshold
   */
  export const Event = {
    Warning: Bus.event(
      "token_budget.warning",
      z.object({
        sessionID: z.string(),
        usage: z.object({
          totalTokens: z.number(),
          limit: z.number(),
          percentage: z.number(),
        }),
      }),
    ),
    Critical: Bus.event(
      "token_budget.critical",
      z.object({
        sessionID: z.string(),
        usage: z.object({
          totalTokens: z.number(),
          limit: z.number(),
          percentage: z.number(),
        }),
      }),
    ),
    Exceeded: Bus.event(
      "token_budget.exceeded",
      z.object({
        sessionID: z.string(),
        usage: z.object({
          totalTokens: z.number(),
          limit: z.number(),
        }),
      }),
    ),
  }

  /**
   * Get token limit from runtime config
   */
  function getLimit(): number {
    return SESSION_TOKEN_CAP
  }

  /**
   * Get or create session usage tracker
   */
  function getUsage(sessionID: string): SessionUsage {
    if (!sessionUsage.has(sessionID)) {
      sessionUsage.set(sessionID, {
        sessionID,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        startTime: Date.now(),
        lastUpdate: Date.now(),
      })
    }
    return sessionUsage.get(sessionID)!
  }

  /**
   * Track token usage for a session
   */
  export async function track(input: {
    sessionID: string
    inputTokens: number
    outputTokens: number
  }): Promise<{ allowed: boolean; usage: SessionUsage; limit: number; message?: string }> {
    const usage = getUsage(input.sessionID)
    const limit = getLimit()

    // Update usage
    usage.totalInputTokens += input.inputTokens
    usage.totalOutputTokens += input.outputTokens
    usage.totalTokens = usage.totalInputTokens + usage.totalOutputTokens
    usage.lastUpdate = Date.now()

    // If token budget tracking is disabled, always allow
    if (!ENABLED) {
      return {
        allowed: true,
        usage,
        limit,
      }
    }

    const percentage = usage.totalTokens / limit

    log.info("token usage tracked", {
      sessionID: input.sessionID,
      totalTokens: usage.totalTokens,
      limit,
      percentage: (percentage * 100).toFixed(1) + "%",
    })

    // Check thresholds
    if (percentage >= 1.0) {
      Bus.publish(Event.Exceeded, {
        sessionID: input.sessionID,
        usage: {
          totalTokens: usage.totalTokens,
          limit,
        },
      })

      return {
        allowed: false,
        usage,
        limit,
        message: `Session token budget exceeded (${usage.totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens). Please start a new session or increase your budget.`,
      }
    }

    if (percentage >= CRITICAL_THRESHOLD) {
      Bus.publish(Event.Critical, {
        sessionID: input.sessionID,
        usage: {
          totalTokens: usage.totalTokens,
          limit,
          percentage,
        },
      })

      return {
        allowed: true,
        usage,
        limit,
        message: `⚠️ Critical: ${(percentage * 100).toFixed(0)}% of token budget used (${usage.totalTokens.toLocaleString()} / ${limit.toLocaleString()}). Consider starting a new session.`,
      }
    }

    if (percentage >= WARNING_THRESHOLD) {
      Bus.publish(Event.Warning, {
        sessionID: input.sessionID,
        usage: {
          totalTokens: usage.totalTokens,
          limit,
          percentage,
        },
      })

      return {
        allowed: true,
        usage,
        limit,
        message: `⚠️ Warning: ${(percentage * 100).toFixed(0)}% of token budget used (${usage.totalTokens.toLocaleString()} / ${limit.toLocaleString()}).`,
      }
    }

    return {
      allowed: true,
      usage,
      limit,
    }
  }

  /**
   * Get current usage for a session
   */
  export function getSessionUsage(sessionID: string): SessionUsage | null {
    return sessionUsage.get(sessionID) ?? null
  }

  /**
   * Reset usage for a session
   */
  export function reset(sessionID: string) {
    sessionUsage.delete(sessionID)
    log.info("token budget reset", { sessionID })
  }

  /**
   * Clean up old sessions (prevent memory leak)
   */
  export function cleanup(sessionID: string) {
    sessionUsage.delete(sessionID)
  }

  /**
   * Get statistics across all sessions
   */
  export function getGlobalStats() {
    const sessions = Array.from(sessionUsage.values())

    return {
      activeSessions: sessions.length,
      totalTokens: sessions.reduce((sum, s) => sum + s.totalTokens, 0),
      totalInputTokens: sessions.reduce((sum, s) => sum + s.totalInputTokens, 0),
      totalOutputTokens: sessions.reduce((sum, s) => sum + s.totalOutputTokens, 0),
      averageTokensPerSession:
        sessions.length > 0 ? sessions.reduce((sum, s) => sum + s.totalTokens, 0) / sessions.length : 0,
    }
  }

  /**
   * Reload configuration (useful for testing and hot-reloading)
   */
  export async function reloadConfig() {
    await loadConfig()
  }
}
