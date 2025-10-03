/**
 * Intelligent feedback request manager.
 * 
 * Requests user feedback at optimal times to maximize response rate
 * while minimizing interruption.
 * 
 * Strategy:
 * - Only request feedback when session is idle
 * - Focus on expensive or unusual operations
 * - Rate-limit to avoid fatigue (max 1 per hour per user)
 * - Track response rates and adjust strategy
 */

import { Bus } from "../bus"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Trace } from "../trace"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Telemetry } from "./telemetry"

const log = Log.create({ service: "evaluation.feedback-manager" })

export namespace FeedbackManager {
  export type Strategy = {
    /** Only ask for traces costing more than this (dollars) */
    minCostThreshold: number
    /** Only ask for traces longer than this (ms) */
    minDurationThreshold: number
    /** Ask for random traces this % of the time */
    randomSamplingRate: number
    /** Maximum feedback requests per hour */
    maxRequestsPerHour: number
    /** Minimum time since last request (ms) */
    minTimeSinceLastRequest: number
  }

  const defaultStrategy: Strategy = {
    minCostThreshold: 0.05, // $0.05
    minDurationThreshold: 10000, // 10 seconds
    randomSamplingRate: 0.05, // 5%
    maxRequestsPerHour: 1,
    minTimeSinceLastRequest: 60 * 60 * 1000, // 1 hour
  }

  let strategy: Strategy = defaultStrategy
  let enabled = false
  let unsubscribe: (() => void) | null = null

  // Track last request time per session
  const lastRequestTime = new Map<string, number>()

  // Track requests made this hour
  let requestsThisHour = 0
  let hourResetTimer: Timer | null = null

  /**
   * Enable feedback requests with optional custom strategy.
   */
  export function enable(customStrategy?: Partial<Strategy>) {
    if (enabled) {
      log.warn("feedback manager already enabled")
      return
    }

    strategy = { ...defaultStrategy, ...customStrategy }
    enabled = true

    // Subscribe to idle events
    unsubscribe = Bus.subscribe(SessionPrompt.Event.Idle, async ({ properties }) => {
      try {
        await handleIdleSession(properties.sessionID)
      } catch (error) {
        log.error("failed to handle idle session", { sessionID: properties.sessionID, error })
      }
    })

    // Reset hourly counter
    hourResetTimer = setInterval(() => {
      requestsThisHour = 0
      log.debug("reset hourly request counter")
    }, 60 * 60 * 1000)

    log.info("feedback manager enabled", { strategy })
  }

  /**
   * Disable feedback requests.
   */
  export function disable() {
    if (!enabled) return

    enabled = false
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    if (hourResetTimer) {
      clearInterval(hourResetTimer)
      hourResetTimer = null
    }

    log.info("feedback manager disabled")
  }

  /**
   * Check if we should request feedback for a trace.
   */
  function shouldRequestFeedback(trace: Trace.Complete, sessionID: string): boolean {
    // Check rate limits
    if (requestsThisHour >= strategy.maxRequestsPerHour) {
      log.debug("skipping feedback: hourly limit reached")
      return false
    }

    const lastRequest = lastRequestTime.get(sessionID) || 0
    if (Date.now() - lastRequest < strategy.minTimeSinceLastRequest) {
      log.debug("skipping feedback: too soon since last request")
      return false
    }

    // Check thresholds
    const isExpensive = trace.summary.cost >= strategy.minCostThreshold
    const isLong = trace.summary.duration >= strategy.minDurationThreshold
    const hasErrors = trace.summary.errorCount > 0
    const isRandom = Math.random() < strategy.randomSamplingRate

    const shouldAsk = isExpensive || isLong || hasErrors || isRandom

    if (shouldAsk) {
      log.debug("feedback criteria met", {
        traceID: trace.id,
        isExpensive,
        isLong,
        hasErrors,
        isRandom,
      })
    }

    return shouldAsk
  }

  /**
   * Handle an idle session by checking recent traces.
   */
  async function handleIdleSession(sessionID: string) {
    if (!enabled) return

    log.debug("checking for feedback opportunity", { sessionID })

    // Get recent traces for this session
    const recentTraces = await getRecentTracesForSession(sessionID, 5)

    if (recentTraces.length === 0) {
      log.debug("no recent traces for feedback", { sessionID })
      return
    }

    // Find traces worth asking about
    const candidateTraces = recentTraces.filter((trace) =>
      shouldRequestFeedback(trace, sessionID)
    )

    if (candidateTraces.length === 0) {
      log.debug("no candidate traces for feedback", { sessionID })
      return
    }

    // Request feedback for the most recent candidates (up to 3)
    const tracesToAsk = candidateTraces.slice(0, 3)
    await Telemetry.requestFeedback(tracesToAsk.map((t) => t.id))

    // Update rate limiting
    requestsThisHour++
    lastRequestTime.set(sessionID, Date.now())

    log.info("feedback requested", {
      sessionID,
      traceCount: tracesToAsk.length,
      traceIDs: tracesToAsk.map((t) => t.id),
    })
  }

  /**
   * Get recent traces for a session.
   */
  async function getRecentTracesForSession(
    sessionID: string,
    limit: number
  ): Promise<Trace.Complete[]> {
    try {
      const session = await Session.get(sessionID)
      const keys = await Storage.list(["trace", session.projectID, sessionID])

      // Get all traces and sort by timestamp
      const traces: Trace.Complete[] = []
      for (const key of keys) {
        try {
          const trace = await Storage.read<Trace.Complete>(key)
          traces.push(trace)
        } catch {
          // Skip invalid traces
        }
      }

      // Sort by completion time (newest first) and limit
      return traces
        .filter((t) => t.completedAt) // Only completed traces
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
        .slice(0, limit)
    } catch (error) {
      log.warn("failed to get recent traces", { sessionID, error })
      return []
    }
  }

  /**
   * Get feedback statistics.
   */
  export async function getStatistics(): Promise<{
    totalRequested: number
    totalResponded: number
    responseRate: number
    avgResponseTime: number
  }> {
    const feedbackKeys = await Storage.list(["feedback"])
    const feedbacks: Telemetry.UserFeedback[] = []

    for (const key of feedbackKeys) {
      try {
        const feedback = await Storage.read<Telemetry.UserFeedback>(key)
        feedbacks.push(feedback)
      } catch {
        // Skip invalid feedback
      }
    }

    const totalResponded = feedbacks.length
    // Note: We don't currently track requests separately, so this is an approximation
    const totalRequested = totalResponded * 3 // Assume ~30% response rate

    const responseRate = totalRequested > 0 ? totalResponded / totalRequested : 0

    const responseTimes = feedbacks.map((f) => f.respondedAt - f.requestedAt)
    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0

    return {
      totalRequested,
      totalResponded,
      responseRate,
      avgResponseTime,
    }
  }

  /**
   * Update feedback strategy based on observed response rates.
   */
  export async function adaptStrategy() {
    const stats = await getStatistics()

    // If response rate is very low, reduce request frequency
    if (stats.responseRate < 0.1 && stats.totalResponded > 10) {
      strategy.maxRequestsPerHour = Math.max(1, strategy.maxRequestsPerHour - 1)
      strategy.minTimeSinceLastRequest += 30 * 60 * 1000 // Add 30 minutes
      log.info("adapted strategy: reduced request frequency", { strategy })
    }

    // If response rate is high, we can ask more often
    if (stats.responseRate > 0.4 && stats.totalResponded > 20) {
      strategy.maxRequestsPerHour = Math.min(3, strategy.maxRequestsPerHour + 1)
      strategy.minTimeSinceLastRequest = Math.max(
        30 * 60 * 1000,
        strategy.minTimeSinceLastRequest - 15 * 60 * 1000
      )
      log.info("adapted strategy: increased request frequency", { strategy })
    }
  }
}
