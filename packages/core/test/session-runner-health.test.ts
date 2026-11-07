import { describe, expect, it } from "bun:test"
import { AIError, ProviderInternalError, RateLimitError, TransportError } from "@opencode/ai"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerHealth } from "@opencode/core/session/runner/provider-health"
import { Effect } from "effect"

const rateLimit = (retryAfterMs?: number) =>
  new AIError({ reason: new RateLimitError({ message: "rate limited", retryAfterMs }) })
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request" }),
})

const KEY = "provider"
const OTHER = "other"

// Concurrent sessions coordinate through one health instance; the sequence here
// stands in for the interleaved retry decisions of a real multi-session run.
const coordinate = (
  health: Awaited<ReturnType<typeof makeHealth>>,
  options: {
    sessionID?: SessionSchema.ID
    key?: string
    cause?: AIError
    decision?: { retry: false } | { retry: true; attempt: number; delay: number }
    clean?: boolean
    now: number
  },
) =>
  health.coordinate({
    key: options.key ?? KEY,
    sessionID: options.sessionID ?? SessionSchema.ID.make("ses_a"),
    cause: options.cause,
    decision: options.decision ?? { retry: true, attempt: 1, delay: 2000 },
    clean: options.clean ?? true,
    now: options.now,
  })

const makeHealth = () => Effect.runPromise(SessionRunnerHealth.make)

describe("SessionRunnerHealth", () => {
  it("keeps a single session on its own policy: many failures never raise the floor", async () => {
    const health = await makeHealth()
    const session = SessionSchema.ID.make("ses_solo")
    let now = 1000
    for (let i = 0; i < 10; i++) {
      const decision = coordinate(health, { sessionID: session, cause: internal, now })
      expect(decision).toEqual({ retry: true, attempt: 1, delay: 2000 })
      now += 3000
    }
  })

  it("floors the delay while a shared Retry-After is in effect", async () => {
    const health = await makeHealth()
    const raised = coordinate(health, { cause: rateLimit(10_000), now: 1000 })
    expect(raised).toEqual({ retry: true, attempt: 1, delay: 10_000 })
    // A second session's 429 pushes the shared window out to its own now + Retry-After.
    expect(coordinate(health, { sessionID: SessionSchema.ID.make("ses_b"), cause: rateLimit(10_000), now: 5000 })).toEqual({
      retry: true,
      attempt: 1,
      delay: 10_000,
    })
    // Without a fresh Retry-After the remaining shared window still floors the delay.
    expect(coordinate(health, { now: 11_000 })).toEqual({ retry: true, attempt: 1, delay: 4_000 })
  })

  it("never opens the breaker from rate limits, even across many sessions", async () => {
    const health = await makeHealth()
    let now = 1000
    for (let i = 0; i < 10; i++) {
      const decision = coordinate(health, {
        sessionID: SessionSchema.ID.make(`ses_rate_${i}`),
        cause: rateLimit(1000),
        now,
      })
      // Only the per-session delay, plus the ~1s shared Retry-After — never a cooldown.
      expect(decision).toEqual({ retry: true, attempt: 1, delay: 2000 })
      now += 1500
    }
  })

  it("counts clean 5xx / transport failures across distinct sessions toward the cooldown", async () => {
    const health = await makeHealth()
    let now = 1000
    for (let i = 0; i < 3; i++) {
      coordinate(health, { sessionID: SessionSchema.ID.make(`ses_${i}`), cause: internal, now })
      now += 1000
    }
    // Four sessions failing: below the threshold, no floor beyond the per-session delay.
    expect(coordinate(health, { sessionID: SessionSchema.ID.make("ses_4a"), cause: internal, now })).toEqual({
      retry: true,
      attempt: 1,
      delay: 2000,
    })
    // The fifth distinct session trips the shared cooldown — including for itself,
    // since its retry decision folds in after the failure is recorded.
    now += 1000
    const opened = coordinate(health, { sessionID: SessionSchema.ID.make("ses_5th"), cause: internal, now })
    expect(opened.retry).toBe(true)
    expect(opened.retry && opened.delay).toBe(60_000)
    // Every session on the route now waits out the shared cooldown.
    expect(coordinate(health, { sessionID: SessionSchema.ID.make("ses_6th"), cause: internal, now })).toEqual({
      retry: true,
      attempt: 1,
      delay: 60_000,
    })
  })

  it("doubles the cooldown when failures continue past an elapsed cooldown", async () => {
    const health = await makeHealth()
    let now = 1000
    for (let i = 0; i < 5; i++) {
      coordinate(health, { sessionID: SessionSchema.ID.make(`ses_${i}`), cause: internal, now })
      now += 1000
    }
    // First cooldown opened at ~6000 (60s). The next failure after it elapses is a
    // failed probe: the cooldown doubles to 120s.
    now = 66_000
    const probed = coordinate(health, { sessionID: SessionSchema.ID.make("ses_probe"), cause: internal, now })
    expect(probed.retry).toBe(true)
    expect(probed.retry && probed.delay).toBe(120_000)
  })

  it("clears the record when a provider response settles", async () => {
    const health = await makeHealth()
    let now = 1000
    for (let i = 0; i < 5; i++) {
      coordinate(health, { sessionID: SessionSchema.ID.make(`ses_${i}`), cause: internal, now })
      now += 1000
    }
    health.recordSuccess(KEY)
    expect(coordinate(health, { now })).toEqual({ retry: true, attempt: 1, delay: 2000 })
  })

  it("ignores partial-stream failures so a client-side break does not blame the provider", async () => {
    const health = await makeHealth()
    let now = 1000
    for (let i = 0; i < 8; i++) {
      coordinate(health, {
        sessionID: SessionSchema.ID.make(`ses_${i}`),
        cause: internal,
        clean: false,
        now,
      })
      now += 1000
    }
    expect(coordinate(health, { now })).toEqual({ retry: true, attempt: 1, delay: 2000 })
  })

  it("keeps unrelated provider routes isolated", async () => {
    const health = await makeHealth()
    let now = 1000
    for (let i = 0; i < 5; i++) {
      coordinate(health, { key: KEY, sessionID: SessionSchema.ID.make(`ses_${i}`), cause: timeout, now })
      now += 1000
    }
    expect(coordinate(health, { key: OTHER, now })).toEqual({ retry: true, attempt: 1, delay: 2000 })
  })

  it("never raises a decision the per-session policy already gave up on", async () => {
    const health = await makeHealth()
    coordinate(health, { cause: rateLimit(10_000), now: 1000 })
    expect(
      coordinate(health, { decision: { retry: false }, now: 2000, cause: rateLimit(10_000) }),
    ).toEqual({ retry: false })
  })
})
