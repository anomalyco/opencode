import { expect } from "bun:test"
import { Clock, Effect, FiberSet, Layer } from "effect"
import { TestClock } from "effect/testing"
import { McpRecovery } from "@opencode/core/mcp/recovery"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const controller = Effect.gen(function* () {
  const run = yield* FiberSet.makeRuntime<never, void, never>()
  const state = {
    forks: 0,
    attempts: [] as number[],
    outcome: "retryable" as "retryable" | "permanent" | "connected",
  }
  const recovery = McpRecovery.make({
    name: "test",
    stale: () => false,
    fork: (effect) => {
      state.forks++
      return run(effect)
    },
    attempt: Effect.gen(function* () {
      state.attempts.push(yield* Clock.currentTimeMillis)
      if (state.outcome === "connected") return yield* recovery.notifyConnected()
      yield* recovery.notifyFailure({ retryable: state.outcome === "retryable" })
    }),
  })
  return { state, recovery }
})

it.effect("one worker sustains a 72-hour outage, then stops on recovery", () =>
  Effect.gen(function* () {
    const target = yield* controller
    yield* target.recovery.notifyFailure({ retryable: true })
    yield* Effect.yieldNow
    for (let minute = 0; minute < 72 * 60; minute++) yield* TestClock.adjust("1 minute")
    expect(target.state.forks).toBe(1)
    expect(target.state.attempts.length).toBeGreaterThan(4_000)
    const gaps = target.state.attempts.slice(1).map((time, index) => Math.round(time - target.state.attempts[index]))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(800)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000)
    target.state.outcome = "connected"
    yield* TestClock.adjust("1 minute")
    const attempts = target.state.attempts.length
    yield* TestClock.adjust("24 hours")
    expect(target.state.attempts).toHaveLength(attempts)
    expect(target.state.forks).toBe(1)
  }),
)

it.effect("honors Retry-After without forking another worker for duplicate failures", () =>
  Effect.gen(function* () {
    const target = yield* controller
    target.state.outcome = "connected"
    yield* target.recovery.notifyFailure({ retryable: true, retryAfter: 30_000 })
    yield* target.recovery.notifyFailure({ retryable: true, retryAfter: 30_000 })
    yield* Effect.yieldNow
    yield* TestClock.adjust("29 seconds")
    expect(target.state.attempts).toHaveLength(0)
    yield* TestClock.adjust("1 second")
    expect(target.state.attempts).toHaveLength(1)
    expect(target.state.forks).toBe(1)
  }),
)

it.effect("a permanent retry failure ends the loop", () =>
  Effect.gen(function* () {
    const target = yield* controller
    target.state.outcome = "permanent"
    yield* target.recovery.notifyFailure({ retryable: true })
    yield* Effect.yieldNow
    yield* TestClock.adjust("1 minute")
    expect(target.state.attempts).toHaveLength(1)
    yield* TestClock.adjust("24 hours")
    expect(target.state.attempts).toHaveLength(1)
    expect(target.state.forks).toBe(1)
  }),
)

it.effect("disconnect cancels a dropped connection's worker until an explicit reset", () =>
  Effect.gen(function* () {
    const target = yield* controller
    yield* target.recovery.notifyConnected()
    yield* target.recovery.notifyClosed()
    yield* Effect.yieldNow
    yield* target.recovery.cancel()
    // Late failure/close callbacks cannot resurrect a disconnected server.
    yield* target.recovery.notifyClosed()
    yield* target.recovery.notifyFailure({ retryable: true })
    yield* TestClock.adjust("24 hours")
    expect(target.state.attempts).toHaveLength(0)
    expect(target.state.forks).toBe(1)
    yield* target.recovery.reset()
    target.state.outcome = "connected"
    yield* target.recovery.notifyFailure({ retryable: true })
    yield* Effect.yieldNow
    yield* TestClock.adjust("1 minute")
    expect(target.state.attempts).toHaveLength(1)
    expect(target.state.forks).toBe(2)
  }),
)

it.effect("flapping connections keep backoff until they have been stable for 30 seconds", () =>
  Effect.gen(function* () {
    const target = yield* controller
    target.state.outcome = "connected"
    yield* target.recovery.notifyFailure({ retryable: true })
    yield* Effect.yieldNow
    yield* TestClock.adjust("2 seconds")
    yield* target.recovery.notifyClosed()
    yield* Effect.yieldNow
    yield* TestClock.adjust("1 second")
    expect(target.state.attempts).toHaveLength(1)
    yield* TestClock.adjust("2 seconds")
    expect(target.state.attempts).toHaveLength(2)
    yield* TestClock.adjust("30 seconds")
    yield* target.recovery.notifyClosed()
    yield* Effect.yieldNow
    yield* TestClock.adjust("2 seconds")
    expect(target.state.attempts).toHaveLength(3)
  }),
)
