import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Scope } from "effect"
import { TestClock } from "effect/testing"
import { Detaching } from "@opencode/core/detaching"
import { it } from "./lib/effect"

describe("Detaching", () => {
  it.live("runs its hooks only when a prepared handoff makes shutdown detach", () =>
    Effect.gen(function* () {
      const quit = yield* Detaching.make
      let ran = 0
      yield* quit.onDetach(Effect.sync(() => ran++))
      expect(yield* quit.begin).toBe(false)
      expect(ran).toBe(0)

      const detaching = yield* Detaching.make
      yield* detaching.onDetach(Effect.sync(() => ran++))
      yield* detaching.onDetach(Effect.die("a failing hook does not stop the others"))
      yield* detaching.onDetach(Effect.sync(() => ran++))
      yield* detaching.handoffPrepared
      expect(yield* detaching.begin).toBe(true)
      expect(detaching.isDetaching()).toBe(true)
      expect(ran).toBe(2)
    }),
  )

  it.effect("bounds slow hooks and forgets hooks whose scope closed", () =>
    Effect.gen(function* () {
      const detaching = yield* Detaching.make
      let ran = 0
      const scope = yield* Scope.make()
      yield* detaching.onDetach(Effect.sync(() => ran++)).pipe(Effect.provideService(Scope.Scope, scope))
      yield* Scope.close(scope, Exit.void)
      yield* detaching.onDetach(Effect.never)
      yield* detaching.handoffPrepared
      const begin = yield* detaching.begin.pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("499 millis")
      expect(begin.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 millis")
      expect(yield* Fiber.join(begin)).toBe(true)
      expect(ran).toBe(0)
    }),
  )

  it.effect("starts stopping on any shutdown, detaching or not", () =>
    Effect.gen(function* () {
      const detaching = yield* Detaching.make
      expect(detaching.isStopping()).toBe(false)
      expect(yield* detaching.begin).toBe(false)
      expect(detaching.isStopping()).toBe(true)
      expect(detaching.isDetaching()).toBe(false)
    }),
  )
})
