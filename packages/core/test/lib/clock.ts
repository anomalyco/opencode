import { Effect } from "effect"
import { TestClock } from "effect/testing"

// Defers on a real macrotask so pubsub delivery, fiber hops, and filesystem
// work can complete between TestClock advances.
const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)))

// One advance step: let pending real work finish, then fire due TestClock timers.
const tick = Effect.gen(function* () {
  yield* settle
  yield* TestClock.adjust("500 millis")
})

/**
 * Drives every pending TestClock timer to completion: stream debounces register
 * their sleeps from separate fiber hops that a single adjust can miss, so the
 * loop alternates real-macrotask settles with adjusts until the condition
 * holds. Extra adjusts are harmless when nothing is pending.
 *
 * Bounded by real time, not a step count: the condition can also wait on real
 * work such as a plugin import, which needs many more steps on a loaded CI
 * runner than locally.
 */
export const advance = Effect.fnUntraced(function* (condition: () => boolean) {
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline) {
    if (condition()) return
    yield* tick
  }
  if (condition()) return
  return yield* Effect.die(new Error("condition never became true within 15s"))
})

/**
 * Advances far enough that any pending debounced work would have completed,
 * so a no-op assertion afterwards is meaningful.
 */
export const drain = Effect.gen(function* () {
  for (let round = 0; round < 4; round++) {
    yield* tick
  }
  yield* settle
})
