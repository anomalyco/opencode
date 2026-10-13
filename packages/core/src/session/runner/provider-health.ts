export * as SessionRunnerHealth from "./provider-health.js"

import type { AIError } from "@opencode/ai"

/**
 * Cross-session provider health, shared within one server process.
 *
 * Each session's retry policy is deliberately scoped to that session, so concurrent
 * sessions and subagents retry the same failing provider independently and every
 * attempt still burns a request. This module tracks failures per provider key so
 * those sessions coordinate:
 *  - a 429's `Retry-After` yields one shared next-allowed time for every session,
 *    instead of each session discovering it by failing on its own;
 *  - sustained 5xx / connection failures open a circuit so new attempts fail fast
 *    until a cooldown elapses, then one probe request is let through;
 *  - in-flight streams are never touched: the gate only decides whether a new
 *    attempt may start.
 *
 * See https://github.com/anomalyco/opencode/issues/55075 for the field data.
 */

/** Consecutive provider-level failures before the circuit opens: roughly half of one exhausted per-session policy, so a single unlucky session cannot trip it alone while 2-3 concurrent sessions can. */
const OPEN_THRESHOLD = 5
/** Initial open-state cooldown, then doubled per further failure up to the cap. The per-session policy burns ~84s over its 10 attempts, so 60s opens the circuit around the time sessions would give up anyway. */
const OPEN_COOLDOWN_MS = 60_000
const OPEN_COOLDOWN_MAX_MS = 15 * 60_000
/** A half-open probe has this long to settle (via recordSuccess/recordFailure) before another probe is allowed, so a probe lost to cancellation cannot wedge the half-open state. */
const PROBE_WINDOW_MS = 30_000
/** A hostile or buggy retry-after cannot stall new attempts for hours (mirrors the per-session cap in retry.ts). */
const RETRY_AFTER_MAX_MS = 15 * 60_000

interface State {
  consecutiveFailures: number
  openUntil: number
  probeUntil: number
  nextAllowedAt: number
}

// One map per server process; sessions reach it through the attempt gate and the
// retry path, which is all the coordination the storm fix needs.
const states = new Map<string, State>()

const state = (key: string): State => {
  let s = states.get(key)
  if (!s) {
    s = { consecutiveFailures: 0, openUntil: 0, probeUntil: 0, nextAllowedAt: 0 }
    states.set(key, s)
  }
  return s
}

/** One health bucket per provider route; routes (and their credentials) share fate because they are load-balanced together. */
export const key = (provider: string, routeKey: string | undefined): string => routeKey ?? provider

/** Provider-requested retry delay, only where the provider actually signals one. */
export const retryAfterMs = (cause: AIError): number | undefined => {
  if (cause.reason._tag === "RateLimit" || cause.reason._tag === "ProviderInternal")
    return cause.reason.retryAfterMs
  return undefined
}

export const canAttempt = (key: string, now: number): { allowed: boolean; retryInMs: number } => {
  const s = states.get(key)
  if (!s) return { allowed: true, retryInMs: 0 }
  if (now < s.nextAllowedAt) return { allowed: false, retryInMs: s.nextAllowedAt - now }
  if (now < s.openUntil) return { allowed: false, retryInMs: s.openUntil - now }
  if (s.consecutiveFailures >= OPEN_THRESHOLD) {
    // Half-open: let this attempt probe the provider while holding others back
    // until the probe settles or the window expires.
    s.openUntil = now + PROBE_WINDOW_MS
    s.probeUntil = s.openUntil
  }
  return { allowed: true, retryInMs: 0 }
}

export const recordFailure = (key: string, now: number, cause: AIError | undefined): void => {
  const s = state(key)
  s.probeUntil = 0
  s.consecutiveFailures++
  const after = cause === undefined ? undefined : retryAfterMs(cause)
  if (after !== undefined) s.nextAllowedAt = now + Math.min(Math.max(0, after), RETRY_AFTER_MAX_MS)
  if (s.consecutiveFailures >= OPEN_THRESHOLD) {
    const doubling = Math.min(2 ** Math.min(s.consecutiveFailures - OPEN_THRESHOLD, 4), 16)
    s.openUntil = now + Math.min(OPEN_COOLDOWN_MS * doubling, OPEN_COOLDOWN_MAX_MS)
  }
}

export const recordSuccess = (key: string): void => {
  states.delete(key)
}

/** Test seam: drops all shared state between tests. */
export const $reset = (): void => {
  states.clear()
}
