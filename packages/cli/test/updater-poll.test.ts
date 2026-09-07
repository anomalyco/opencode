import { expect } from "bun:test"
import { Effect, Layer, Queue } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../../core/test/lib/effect"
import { Updater } from "../src/services/updater"

const it = testEffect(Layer.empty)

it.effect("polls after 1 minute and every 10 minutes after that", () =>
  Effect.gen(function* () {
    const checks = yield* Queue.unbounded<void>()
    yield* Updater.pollUpdates({ check: Queue.offer(checks, undefined).pipe(Effect.asVoid) }).pipe(Effect.forkScoped)

    yield* Effect.yieldNow
    expect(yield* Queue.size(checks)).toBe(0)
    yield* TestClock.adjust("59 seconds")
    expect(yield* Queue.size(checks)).toBe(0)
    yield* TestClock.adjust("1 second")
    yield* Queue.take(checks)
    yield* Effect.yieldNow
    yield* TestClock.adjust("10 minutes")
    yield* Queue.take(checks)
  }),
)
