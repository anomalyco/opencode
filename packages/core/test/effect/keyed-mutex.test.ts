import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { KeyedMutex } from "@opencode/core/effect/keyed-mutex"
import { it } from "../lib/effect"

describe("KeyedMutex", () => {
  it.effect("serializes effects with the same key", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()

      const first = yield* mutex
        .withLock("shared")(
          Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)
      const second = yield* mutex.withLock("shared")(Deferred.succeed(secondStarted, undefined)).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(secondStarted)).toBe(false)

      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      expect(yield* mutex.size).toBe(0)
    }),
  )

  it.effect("allows different keys to proceed independently", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const secondFinished = yield* Deferred.make<void>()

      const first = yield* mutex
        .withLock("first")(Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)
      yield* mutex.withLock("second")(Deferred.succeed(secondFinished, undefined))
      expect(yield* Deferred.isDone(secondFinished)).toBe(true)

      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(first)
      expect(yield* mutex.size).toBe(0)
    }),
  )

  it.effect("removes an interrupted waiter without dropping the holder lock", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()

      const first = yield* mutex
        .withLock("shared")(
          Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)
      const interrupted = yield* mutex.withLock("shared")(Effect.void).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* Fiber.interrupt(interrupted)
      expect(yield* mutex.size).toBe(1)

      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Fiber.join(first)
      expect(yield* mutex.size).toBe(0)
    }),
  )

  it.effect("releases the lock when the holder is interrupted, so a subsequent acquisition does not hang", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const firstStarted = yield* Deferred.make<void>()

      // Fiber A acquires the lock and holds it until interrupted.
      const first = yield* mutex
        .withLock("shared")(Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)
      yield* Effect.yieldNow

      // Interrupt the holder while it holds the permit.
      yield* Fiber.interrupt(first)

      // A subsequent acquisition on the same key must not hang.
      const secondDone = yield* Deferred.make<void>()
      const second = yield* mutex
        .withLock("shared")(Deferred.succeed(secondDone, undefined))
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(secondDone)).toBe(true)

      yield* Fiber.join(second)
      expect(yield* mutex.size).toBe(0)
    }),
  )
})
