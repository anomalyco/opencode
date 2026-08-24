import { describe, expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LLMError } from "../../src"
import { IdleWatchdog } from "../../src/route"
import { it } from "../lib/effect"

const expectLLMError = (error: unknown) => {
  expect(error).toBeInstanceOf(LLMError)
  if (!(error instanceof LLMError)) throw new Error("expected LLMError")
  return error
}

describe("IdleWatchdog", () => {
  it.effect("passes elements through when gaps stay under the idle budget", () =>
    Effect.gen(function* () {
      const stream = Stream.make(1, 2).pipe(Stream.concat(Stream.fromEffect(Effect.as(Effect.sleep(400), 3))))
      const fiber = yield* IdleWatchdog.guardIdle({ idleMs: 1_000 })(stream).pipe(
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )

      yield* TestClock.adjust(400)
      const events = yield* Fiber.join(fiber)

      expect(events).toEqual([1, 2, 3])
    }),
  )

  it.effect("fails with an IdleTimeout transport error when the provider stalls", () =>
    Effect.gen(function* () {
      const stream = Stream.make("first").pipe(Stream.concat(Stream.never))
      const fiber = yield* IdleWatchdog.guardIdle({ idleMs: 500 })(stream).pipe(
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )

      yield* TestClock.adjust(500)
      const error = yield* Fiber.join(fiber).pipe(Effect.flip)

      expectLLMError(error)
      expect(error.reason).toMatchObject({
        _tag: "Transport",
        kind: "IdleTimeout",
        message: "Provider stream stalled: no data received for 500ms",
      })
    }),
  )

  it.effect("preserves elements emitted before the deadline", () =>
    Effect.gen(function* () {
      const stream = IdleWatchdog.guardIdle({ idleMs: 300 })(
        Stream.make("a", "b").pipe(Stream.concat(Stream.never)),
      )
      const pull = yield* Stream.toPull(stream)

      // the consumer receives both elements before any deadline elapses
      expect(yield* pull).toEqual(["a", "b"])

      // the next pull stalls past the deadline and fails with the typed error
      const stalled = yield* Effect.forkChild({ startImmediately: true })(pull)
      yield* TestClock.adjust(300)
      const error = yield* Fiber.join(stalled).pipe(Effect.flip)

      expectLLMError(error)
    }),
  )

  it.effect("does not arm the deadline before the first element", () =>
    Effect.gen(function* () {
      // silence for longer than idleMs BEFORE the stream begins is not counted
      const stream = Stream.fromEffect(Effect.as(Effect.sleep(2_000), "first")).pipe(Stream.concat(Stream.never))
      const fiber = yield* IdleWatchdog.guardIdle({ idleMs: 300 })(stream).pipe(
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )

      yield* TestClock.adjust(300)
      yield* TestClock.adjust(1_700)
      // first element delivered; from here every 300ms gap trips the watchdog
      yield* TestClock.adjust(300)
      const error = yield* Fiber.join(fiber).pipe(Effect.flip)

      expect(error.reason.message).toBe("Provider stream stalled: no data received for 300ms")
    }),
  )
})
