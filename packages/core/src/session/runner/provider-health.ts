export * as SessionRunnerHealth from "./provider-health.js"

import type { AIError } from "@opencode/ai"
import { Effect } from "effect"
import { SessionSchema } from "../schema.js"
import type { SessionRunnerRetry } from "./retry.js"

/**
 * Cross-session provider health, shared by the sessions of one runner.
 *
 * Each session's retry policy is deliberately scoped to that session, so concurrent
 * sessions and subagents retry the same failing provider independently and every
 * attempt still burns a request. `coordinate` folds a per-session retry decision
 * into a per-route health record so those sessions coordinate:
 *
 *  - a 429's `Retry-After` yields one shared next-allowed time for every session,
 *    instead of each session discovering it by failing on its own;
 *  - once failures come from several distinct sessions, the shared wait grows a
 *    cooldown so the sessions stop pounding the route in overlapping bursts —
 *    after each cooldown the next attempt acts as the probe, and it succeeds
 *    (record clears) or fails (cooldown doubles) without extra bookkeeping;
 *  - rate limits never count toward that cooldown: they only share the
 *    provider-requested delay, which is what #55075 actually asks for;
 *  - the shared wait is a floor on the per-session decision, so the plugin
 *    `session.retry` hook and the session's retry budget stay in the path.
 */

/** Distinct failing sessions before the shared cooldown kicks in. */
const OPEN_THRESHOLD = 5
/** Initial shared cooldown, then doubled per further failure up to the cap. The per-session policy burns ~84s over its 10 attempts, so 60s engages around the time sessions would give up anyway. */
const COOLDOWN_MS = 60_000
const COOLDOWN_MAX_MS = 15 * 60_000
/** A hostile or buggy retry-after cannot stall attempts for hours (mirrors the per-session cap in retry.ts). */
const RETRY_AFTER_MAX_MS = 15 * 60_000

interface State {
  sessions: Set<SessionSchema.ID>
  openUntil: number
  opens: number
  nextAllowedAt: number
}

export interface CoordinateInput {
  readonly key: string
  readonly sessionID: SessionSchema.ID
  /** The provider failure that produced `decision`, or undefined when there is none. */
  readonly cause: AIError | undefined
  /** Decision from the per-session policy; `coordinate` may only raise its delay. */
  readonly decision: { readonly retry: false } | SessionRunnerRetry.Decision
  /** Settle a clean pre-output failure only; partial-stream failures must not blame the provider. */
  readonly clean: boolean
  readonly now: number
}

export interface Service {
  coordinate: (input: CoordinateInput) => { readonly retry: false } | SessionRunnerRetry.Decision
  recordSuccess: (key: string) => void
}

/** One health record per provider route; routes (and their credentials) share fate because they are load-balanced together. */
export const key = (provider: string, routeKey: string | undefined): string => routeKey ?? provider

const retryAfterMs = (cause: AIError | undefined): number | undefined => {
  if (cause === undefined) return undefined
  if (cause.reason._tag === "RateLimit" || cause.reason._tag === "ProviderInternal")
    return cause.reason.retryAfterMs
  return undefined
}

/**
 * Builds an isolated health instance. The runner layer constructs one per server;
 * tests construct one per case, which keeps state out of the module scope.
 */
export const make = Effect.gen(function* () {
  const states = new Map<string, State>()

  const state = (key: string): State => {
    let s = states.get(key)
    if (!s) {
      s = { sessions: new Set(), openUntil: 0, opens: 0, nextAllowedAt: 0 }
      states.set(key, s)
    }
    return s
  }

  const coordinate: Service["coordinate"] = (input) => {
    if (!input.decision.retry) return input.decision
    const s = state(input.key)
    // 5xx and connection failures come from the provider side; rate limits are
    // expected under concurrency and only share the requested delay.
    const counted =
      input.clean &&
      input.cause !== undefined &&
      (input.cause.reason._tag === "Transport" || input.cause.reason._tag === "ProviderInternal")
    if (counted) s.sessions.add(input.sessionID)
    const after = retryAfterMs(input.cause)
    if (input.clean && after !== undefined)
      s.nextAllowedAt = Math.max(s.nextAllowedAt, input.now + Math.min(Math.max(0, after), RETRY_AFTER_MAX_MS))

    let waitUntil = 0
    if (s.sessions.size >= OPEN_THRESHOLD) {
      if (input.now >= s.openUntil) {
        // First opening, or the previous cooldown elapsed and this failure was the probe.
        s.opens++
        s.openUntil = input.now + Math.min(COOLDOWN_MS * 2 ** Math.min(s.opens - 1, 4), COOLDOWN_MAX_MS)
      }
      waitUntil = s.openUntil
    }
    waitUntil = Math.max(waitUntil, s.nextAllowedAt)
    const floor = Math.max(0, waitUntil - input.now)
    return floor > input.decision.delay ? { ...input.decision, delay: floor } : input.decision
  }

  const recordSuccess: Service["recordSuccess"] = (key) => {
    states.delete(key)
  }

  return { coordinate, recordSuccess }
})
