import { Effect } from "effect"

/**
 * Promises settle only through program steps or host calls, so a program that takes no step while no host call is
 * running is waiting on something that can never settle, such as `await new Promise(() => {})`.
 */
export class Activity {
  /** Counts program steps and host calls starting or ending; the hot path only increments it. */
  steps = 0
  private running = 0

  track<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        this.steps++
        this.running++
      }),
      () => effect,
      // Ending counts too: a call can settle just before a check, ahead of the step that consumes its result.
      () =>
        Effect.sync(() => {
          this.steps++
          this.running--
        }),
    )
  }

  /** Completes once a full `idleMs` window passes with no step and no host call running. */
  stalled(idleMs: number): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      let steps = self.steps
      while (true) {
        yield* Effect.sleep(idleMs)
        if (self.running === 0 && self.steps === steps) return
        steps = self.steps
      }
    })
  }
}
