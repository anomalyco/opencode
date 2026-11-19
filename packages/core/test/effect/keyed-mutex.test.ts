import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber } from "effect"
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

  it.effect("releases the lock when an interrupted holder is stopped mid-operation", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const firstStarted = yield* Deferred.make<void>()

      // Fiber A acquires the lock and holds it
      const first = yield* mutex
        .withLock("shared")(Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)

      // Interrupt the holder while it holds the lock
      yield* Fiber.interrupt(first)

      // The entry should be cleaned up
      expect(yield* mutex.size).toBe(0)

      // A subsequent acquisition should not hang
      let acquired = false
      yield* mutex.withLock("shared")(Effect.succeed((acquired = true)))
      expect(acquired).toBe(true)
      expect(yield* mutex.size).toBe(0)
    }),
  )

  it.effect("allows a new acquisition after the previous holder is interrupted", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()
      const firstStarted = yield* Deferred.make<void>()
      const secondStarted = yield* Deferred.make<void>()

      // Fiber A acquires and holds the lock
      const first = yield* mutex
        .withLock("shared")(
          Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never)),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)

      // Fiber B tries to acquire the same key - should block
      const second = yield* mutex
        .withLock("shared")(Deferred.succeed(secondStarted, undefined))
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(secondStarted)).toBe(false)

      // Interrupt the holder (A) - B should now be able to acquire
      yield* Fiber.interrupt(first)
      yield* Deferred.await(secondStarted)

      yield* Fiber.join(second)
      expect(yield* mutex.size).toBe(0)
    }),
  )

  it.live("times out on lock acquisition when the holder is hung", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()

      // Fiber A acquires the lock and never releases it
      const first = yield* mutex
        .withLock("shared")(Effect.never)
        .pipe(Effect.forkChild)
      yield* Effect.sleep("50 millis")

      // Fiber B tries to acquire the same key - should time out instead of hanging forever
      const exit = yield* mutex
        .withLock("shared")(Effect.void)
        .pipe(Effect.timeout("500 millis"), Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)

      yield* Fiber.interrupt(first)
    }),
  )

  it.live("releases the lock after a timed-out acquisition so a later acquisition succeeds", () =>
    Effect.gen(function* () {
      const mutex = yield* KeyedMutex.make<string>()

      // Fiber A holds the lock forever
      const firstStarted = yield* Deferred.make<void>()
      const first = yield* mutex
        .withLock("shared")(
          Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Effect.never)),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)

      // Fiber B times out trying to acquire
      const exit = yield* mutex
        .withLock("shared")(Effect.void)
        .pipe(Effect.timeout("500 millis"), Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)

      // Holder A still holds the lock (size=1), but the timed-out waiter B is gone
      expect(yield* mutex.size).toBe(1)

      // Release A - a later acquisition should succeed without hanging
      yield* Fiber.interrupt(first)
      let acquired = false
      yield* mutex.withLock("shared")(Effect.succeed((acquired = true)))
      expect(acquired).toBe(true)
      expect(yield* mutex.size).toBe(0)
    }),
  )
})
