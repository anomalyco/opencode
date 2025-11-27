import { Log } from "../util/log"
import { Config } from "../config/config"
import { Bus } from "../bus"
import z from "zod"

export namespace Telemetry {
  const log = Log.create({ service: "telemetry" })

  // Runtime configuration
  let ENABLED = true
  let TRACK_RPM = true
  let TRACK_TOKENS = true
  let TRACK_CACHE_HITS = true

  /**
   * Load configuration settings
   */
  async function loadConfig() {
    const config = await Config.get()
    const safety = config.safety?.telemetry

    if (!safety) return

    ENABLED = safety.enabled ?? true
    TRACK_RPM = safety.track_rpm ?? true
    TRACK_TOKENS = safety.track_tokens ?? true
    TRACK_CACHE_HITS = safety.track_cache_hits ?? true

    log.info("config loaded", {
      enabled: ENABLED,
      trackRPM: TRACK_RPM,
      trackTokens: TRACK_TOKENS,
      trackCacheHits: TRACK_CACHE_HITS,
    })
  }

  // Load config on module initialization
  loadConfig().catch((err) => {
    log.error("failed to load config, using defaults", { error: err })
  })

  type RequestMetrics = {
    timestamp: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheHit: boolean
    durationMs: number
    provider: string
    model: string
  }

  type SessionMetrics = {
    sessionID: string
    startTime: number
    lastUpdate: number
    requests: RequestMetrics[]
    totalRequests: number
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    cacheHits: number
    cacheMisses: number
    averageResponseTime: number
  }

  const sessionMetrics = new Map<string, SessionMetrics>()

  /**
   * Event published when telemetry is recorded
   */
  export const Event = {
    MetricsUpdated: Bus.event(
      "telemetry.metrics_updated",
      z.object({
        sessionID: z.string(),
        rpm: z.number(),
        avgTokensPerRequest: z.number(),
        cacheHitRate: z.number(),
        totalRequests: z.number(),
      }),
    ),
  }

  /**
   * Get or create session metrics
   */
  function getMetrics(sessionID: string): SessionMetrics {
    if (!sessionMetrics.has(sessionID)) {
      sessionMetrics.set(sessionID, {
        sessionID,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        requests: [],
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        cacheHits: 0,
        cacheMisses: 0,
        averageResponseTime: 0,
      })
    }
    return sessionMetrics.get(sessionID)!
  }

  /**
   * Record a request
   */
  export function recordRequest(input: {
    sessionID: string
    inputTokens: number
    outputTokens: number
    cacheHit?: boolean
    durationMs?: number
    provider?: string
    model?: string
  }) {
    if (!ENABLED) return

    const metrics = getMetrics(input.sessionID)
    const now = Date.now()

    const request: RequestMetrics = {
      timestamp: now,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.inputTokens + input.outputTokens,
      cacheHit: input.cacheHit ?? false,
      durationMs: input.durationMs ?? 0,
      provider: input.provider ?? "unknown",
      model: input.model ?? "unknown",
    }

    metrics.requests.push(request)
    metrics.lastUpdate = now
    metrics.totalRequests++

    if (TRACK_TOKENS) {
      metrics.totalInputTokens += input.inputTokens
      metrics.totalOutputTokens += input.outputTokens
      metrics.totalTokens += request.totalTokens
    }

    if (TRACK_CACHE_HITS) {
      if (input.cacheHit) {
        metrics.cacheHits++
      } else {
        metrics.cacheMisses++
      }
    }

    if (request.durationMs > 0) {
      // Update rolling average response time
      const totalTime = metrics.averageResponseTime * (metrics.totalRequests - 1) + request.durationMs
      metrics.averageResponseTime = totalTime / metrics.totalRequests
    }

    // Keep only last 100 requests to prevent memory bloat
    if (metrics.requests.length > 100) {
      metrics.requests.shift()
    }

    // Clean up old requests (older than 1 hour)
    const cutoff = now - 60 * 60 * 1000
    metrics.requests = metrics.requests.filter((r) => r.timestamp > cutoff)

    // Publish metrics update
    const stats = calculateStats(metrics)
    Bus.publish(Event.MetricsUpdated, {
      sessionID: input.sessionID,
      rpm: stats.rpm,
      avgTokensPerRequest: stats.avgTokensPerRequest,
      cacheHitRate: stats.cacheHitRate,
      totalRequests: metrics.totalRequests,
    })

    log.debug("request recorded", {
      sessionID: input.sessionID,
      rpm: stats.rpm.toFixed(1),
      cacheHitRate: (stats.cacheHitRate * 100).toFixed(1) + "%",
      avgTokensPerRequest: stats.avgTokensPerRequest.toFixed(0),
    })
  }

  /**
   * Calculate RPM (Requests Per Minute) for the last minute
   */
  function calculateRPM(metrics: SessionMetrics): number {
    if (!TRACK_RPM) return 0

    const now = Date.now()
    const oneMinuteAgo = now - 60 * 1000

    const recentRequests = metrics.requests.filter((r) => r.timestamp >= oneMinuteAgo)
    return recentRequests.length
  }

  /**
   * Calculate cache hit rate
   */
  function calculateCacheHitRate(metrics: SessionMetrics): number {
    if (!TRACK_CACHE_HITS) return 0

    const totalCacheableRequests = metrics.cacheHits + metrics.cacheMisses
    if (totalCacheableRequests === 0) return 0

    return metrics.cacheHits / totalCacheableRequests
  }

  /**
   * Calculate average tokens per request
   */
  function calculateAvgTokensPerRequest(metrics: SessionMetrics): number {
    if (!TRACK_TOKENS || metrics.totalRequests === 0) return 0

    return metrics.totalTokens / metrics.totalRequests
  }

  /**
   * Calculate all stats for a session
   */
  function calculateStats(metrics: SessionMetrics) {
    return {
      rpm: calculateRPM(metrics),
      cacheHitRate: calculateCacheHitRate(metrics),
      avgTokensPerRequest: calculateAvgTokensPerRequest(metrics),
      totalRequests: metrics.totalRequests,
      totalTokens: metrics.totalTokens,
      totalInputTokens: metrics.totalInputTokens,
      totalOutputTokens: metrics.totalOutputTokens,
      cacheHits: metrics.cacheHits,
      cacheMisses: metrics.cacheMisses,
      averageResponseTime: metrics.averageResponseTime,
    }
  }

  /**
   * Get metrics for a session
   */
  export function getSessionMetrics(sessionID: string) {
    const metrics = sessionMetrics.get(sessionID)
    if (!metrics) return null

    return calculateStats(metrics)
  }

  /**
   * Get global metrics across all sessions
   */
  export function getGlobalMetrics() {
    const allMetrics = Array.from(sessionMetrics.values())

    const totalRequests = allMetrics.reduce((sum, m) => sum + m.totalRequests, 0)
    const totalTokens = allMetrics.reduce((sum, m) => sum + m.totalTokens, 0)
    const totalCacheHits = allMetrics.reduce((sum, m) => sum + m.cacheHits, 0)
    const totalCacheMisses = allMetrics.reduce((sum, m) => sum + m.cacheMisses, 0)

    // Calculate global RPM (last minute across all sessions)
    const now = Date.now()
    const oneMinuteAgo = now - 60 * 1000
    const recentRequests = allMetrics
      .flatMap((m) => m.requests)
      .filter((r) => r.timestamp >= oneMinuteAgo)

    return {
      activeSessions: allMetrics.length,
      totalRequests,
      totalTokens,
      globalRPM: recentRequests.length,
      globalCacheHitRate: totalCacheHits + totalCacheMisses > 0 ? totalCacheHits / (totalCacheHits + totalCacheMisses) : 0,
      avgTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
      avgResponseTime:
        allMetrics.length > 0
          ? allMetrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / allMetrics.length
          : 0,
    }
  }

  /**
   * Get detailed metrics breakdown by provider/model
   */
  export function getDetailedMetrics(sessionID: string) {
    const metrics = sessionMetrics.get(sessionID)
    if (!metrics) return null

    const byProvider: Record<string, { requests: number; tokens: number }> = {}
    const byModel: Record<string, { requests: number; tokens: number }> = {}

    for (const request of metrics.requests) {
      // By provider
      if (!byProvider[request.provider]) {
        byProvider[request.provider] = { requests: 0, tokens: 0 }
      }
      byProvider[request.provider].requests++
      byProvider[request.provider].tokens += request.totalTokens

      // By model
      const modelKey = `${request.provider}/${request.model}`
      if (!byModel[modelKey]) {
        byModel[modelKey] = { requests: 0, tokens: 0 }
      }
      byModel[modelKey].requests++
      byModel[modelKey].tokens += request.totalTokens
    }

    return {
      ...calculateStats(metrics),
      byProvider,
      byModel,
    }
  }

  /**
   * Reset metrics for a session
   */
  export function reset(sessionID: string) {
    sessionMetrics.delete(sessionID)
    log.info("telemetry reset", { sessionID })
  }

  /**
   * Cleanup session metrics
   */
  export function cleanup(sessionID: string) {
    sessionMetrics.delete(sessionID)
  }

  /**
   * Generate a summary report for a session
   */
  export function generateReport(sessionID: string): string | null {
    const metrics = sessionMetrics.get(sessionID)
    if (!metrics) return null

    const stats = calculateStats(metrics)
    const sessionDuration = (metrics.lastUpdate - metrics.startTime) / 1000 / 60 // minutes

    return `
📊 Telemetry Report - Session ${sessionID.slice(0, 8)}
${"=".repeat(60)}

⏱️  Session Duration: ${sessionDuration.toFixed(1)} minutes
📈 Total Requests: ${stats.totalRequests}
🚀 Requests Per Minute (RPM): ${stats.rpm.toFixed(1)}
⏳ Average Response Time: ${stats.averageResponseTime.toFixed(0)}ms

💬 Token Usage:
  • Total Tokens: ${stats.totalTokens.toLocaleString()}
  • Input Tokens: ${stats.totalInputTokens.toLocaleString()}
  • Output Tokens: ${stats.totalOutputTokens.toLocaleString()}
  • Avg Tokens/Request: ${stats.avgTokensPerRequest.toFixed(0)}

🎯 Cache Performance:
  • Cache Hits: ${stats.cacheHits}
  • Cache Misses: ${stats.cacheMisses}
  • Hit Rate: ${(stats.cacheHitRate * 100).toFixed(1)}%

${"=".repeat(60)}
    `.trim()
  }

  /**
   * Reload configuration
   */
  export async function reloadConfig() {
    await loadConfig()
  }
}
