import { describe, expect } from "bun:test"
import { Effect, Exit, Scope } from "effect"
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

  it.live("bounds slow hooks and forgets hooks whose scope closed", () =>
    Effect.gen(function* () {
      const detaching = yield* Detaching.make
      let ran = 0
      const scope = yield* Scope.make()
      yield* detaching.onDetach(Effect.sync(() => ran++)).pipe(Effect.provideService(Scope.Scope, scope))
      yield* Scope.close(scope, Exit.void)
      yield* detaching.onDetach(Effect.never)
      yield* detaching.handoffPrepared
      const started = Date.now()
      expect(yield* detaching.begin).toBe(true)
      expect(Date.now() - started).toBeLessThan(2_000)
      expect(ran).toBe(0)
    }),
  )
})
