import { describe, expect, test } from "bun:test"
import { Effect, Duration, Schedule, Clock, Pull } from "effect"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { SessionSchema } from "@opencode/core/session/schema"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { TestClock } from "effect/testing"

const sessionID = SessionSchema.ID.make("ses_test")
const agent = Agent.ID.make("test-agent")
const model = Model.Ref.make({ id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") })

const makeInput = (retryAfterMs?: number) => ({
  cause: {
    reason: { _tag: "RateLimit" as const, retryAfterMs },
  } as any,
  error: { type: "rate_limit", message: "Rate limited" },
  agent,
  model,
  hook: Effect.succeed,
  retry: true,
})

describe("SessionRunnerRetry policy", () => {
  test("policy accepts default config", () => {
    const effect = Effect.gen(function* () {
      const decide = yield* SessionRunnerRetry.policy(sessionID)
      expect(typeof decide).toBe("function")
    })
    Effect.runSync(effect)
  })

  test("policy accepts custom retry config", () => {
    const effect = Effect.gen(function* () {
      const config = { maxRetries: 3, initialDelay: 1000 }
      const decide = yield* SessionRunnerRetry.policy(sessionID, config)
      expect(typeof decide).toBe("function")
    })
    Effect.runSync(effect)
  })

  test("policy with maxRetries=0 disables retries", () => {
    const effect = Effect.gen(function* () {
      const config = { maxRetries: 0 }
      const decide = yield* SessionRunnerRetry.policy(sessionID, config)
      const decision = yield* decide(makeInput())
      expect(decision.retry).toBe(false)
    })
    Effect.runSync(effect)
  })

  test("policy respects maxRetries limit", () => {
    const effect = Effect.gen(function* () {
      const config = { maxRetries: 2, initialDelay: 100 }
      const decide = yield* SessionRunnerRetry.policy(sessionID, config)
      
      // First two attempts should retry
      const decision1 = yield* decide(makeInput())
      expect(decision1.retry).toBe(true)
      
      const decision2 = yield* decide(makeInput())
      expect(decision2.retry).toBe(true)
      
      // Third attempt should not retry (exceeded maxRetries)
      const decision3 = yield* decide(makeInput())
      expect(decision3.retry).toBe(false)
    })
    Effect.runSync(effect)
  })

  test("policy uses custom initialDelay", () => {
    const effect = Effect.gen(function* () {
      const config = { initialDelay: 500 }
      const decide = yield* SessionRunnerRetry.policy(sessionID, config)
      const decision = yield* decide(makeInput())
      expect(decision.retry).toBe(true)
      if (decision.retry) {
        // With jitter, delay should be around 500ms +/- 25%
        expect(decision.delay).toBeGreaterThanOrEqual(375)
        expect(decision.delay).toBeLessThanOrEqual(625)
      }
    })
    Effect.runSync(effect)
  })

  test("policy respects default maxRetries (10)", () => {
    const effect = Effect.gen(function* () {
      const decide = yield* SessionRunnerRetry.policy(sessionID, { initialDelay: 10 })
      
      // Should allow 10 retries
      for (let i = 0; i < 10; i++) {
        const decision = yield* decide(makeInput())
        expect(decision.retry).toBe(true)
      }
      
      // 11th attempt should not retry
      const decision = yield* decide(makeInput())
      expect(decision.retry).toBe(false)
    })
    Effect.runSync(effect)
  })
})
