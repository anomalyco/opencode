import { describe, expect, it } from "bun:test"
import { AIError, ProviderInternalError, RateLimitError, TransportError } from "@opencode/ai"
import { SessionRunnerHealth } from "@opencode/core/session/runner/provider-health"

const rateLimit = (retryAfterMs?: number) =>
  new AIError({ reason: new RateLimitError({ message: "rate limited", retryAfterMs }) })
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})

const KEY = "provider"
const OTHER = "other"

describe("SessionRunnerHealth", () => {
  describe("canAttempt", () => {
    it("allows when the provider has no recorded failures", () => {
      SessionRunnerHealth.$reset()
      expect(SessionRunnerHealth.canAttempt(KEY, 1000)).toEqual({ allowed: true, retryInMs: 0 })
    })

    it("fails fast while the circuit is open", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      const gate = SessionRunnerHealth.canAttempt(KEY, 2000)
      expect(gate.allowed).toBe(false)
      expect(gate.retryInMs).toBeGreaterThan(0)
    })

    it("keeps unrelated providers open while one is failing", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      expect(SessionRunnerHealth.canAttempt(OTHER, 2000).allowed).toBe(true)
    })
  })

  describe("circuit breaker", () => {
    it("opens after the failure threshold and lets one probe through after the cooldown", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      // Still open well before the cooldown elapses.
      expect(SessionRunnerHealth.canAttempt(KEY, 10_000).allowed).toBe(false)
      // Half-open after 60s: the first attempt is the probe.
      expect(SessionRunnerHealth.canAttempt(KEY, 61_000).allowed).toBe(true)
      // While the probe window runs, other attempts wait.
      expect(SessionRunnerHealth.canAttempt(KEY, 62_000).allowed).toBe(false)
    })

    it("resets when the probe succeeds", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      expect(SessionRunnerHealth.canAttempt(KEY, 61_000).allowed).toBe(true)
      SessionRunnerHealth.recordSuccess(KEY)
      expect(SessionRunnerHealth.canAttempt(KEY, 62_000)).toEqual({ allowed: true, retryInMs: 0 })
    })

    it("reopens with a longer cooldown when the probe fails", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      expect(SessionRunnerHealth.canAttempt(KEY, 61_000).allowed).toBe(true)
      SessionRunnerHealth.recordFailure(KEY, 62_000, internal)
      // Second opening doubles the cooldown: still closed 60s later, open at ~120s.
      expect(SessionRunnerHealth.canAttempt(KEY, 100_000).allowed).toBe(false)
      expect(SessionRunnerHealth.canAttempt(KEY, 183_000).allowed).toBe(true)
    })

    it("re-opens the probe window when a probe never settles", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      expect(SessionRunnerHealth.canAttempt(KEY, 61_000).allowed).toBe(true)
      // The probe attempt is cancelled and never records; after the window the
      // next attempt becomes a fresh probe instead of wedging half-open.
      expect(SessionRunnerHealth.canAttempt(KEY, 61_000 + 30_001).allowed).toBe(true)
    })
  })

  describe("shared Retry-After", () => {
    it("blocks all sessions until the provider-requested delay elapses", () => {
      SessionRunnerHealth.$reset()
      SessionRunnerHealth.recordFailure(KEY, 1000, rateLimit(10_000))
      expect(SessionRunnerHealth.canAttempt(KEY, 5000)).toEqual({ allowed: false, retryInMs: 6000 })
      expect(SessionRunnerHealth.canAttempt(KEY, 11_000)).toEqual({ allowed: true, retryInMs: 0 })
    })

    it("counts rate limits toward opening the circuit", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, rateLimit(1000))
      const gate = SessionRunnerHealth.canAttempt(KEY, 1500)
      expect(gate.allowed).toBe(false)
      // The shared Retry-After (last recorded) governs the wait, not the cooldown.
      expect(gate.retryInMs).toBe(500)
    })

    it("caps a hostile retry-after at 15 minutes", () => {
      SessionRunnerHealth.$reset()
      SessionRunnerHealth.recordFailure(KEY, 0, rateLimit(24 * 60 * 60 * 1000))
      expect(SessionRunnerHealth.canAttempt(KEY, 15 * 60_000)).toEqual({ allowed: true, retryInMs: 0 })
      expect(SessionRunnerHealth.canAttempt(KEY, 15 * 60_000 - 1).allowed).toBe(false)
    })

    it("does not record a shared next-allowed time for provider-internal failures", () => {
      SessionRunnerHealth.$reset()
      SessionRunnerHealth.recordFailure(KEY, 1000, internal)
      expect(SessionRunnerHealth.canAttempt(KEY, 1000).allowed).toBe(true)
    })
  })

  describe("transport failures", () => {
    it("count toward the circuit like any other failure", () => {
      SessionRunnerHealth.$reset()
      for (let i = 0; i < 5; i++) SessionRunnerHealth.recordFailure(KEY, 1000, timeout)
      expect(SessionRunnerHealth.canAttempt(KEY, 2000).allowed).toBe(false)
    })
  })
})
