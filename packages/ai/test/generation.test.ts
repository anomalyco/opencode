import { describe, expect } from "bun:test"
import { Effect, Fiber, Ref, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import {
  AIError,
  InvalidProviderOutputError,
  Generation,
  type GenerationRoute,
  type GenerationSnapshot,
  type GenerationStatus,
} from "../src/index.js"
import { it } from "./lib/effect.js"

/** In-memory generation route whose status advances through `statuses` on every poll. */
const scriptedRoute = (statuses: ReadonlyArray<GenerationStatus>, result: string) =>
  Effect.gen(function* () {
    const polls = yield* Ref.make(0)
    const cancelled = yield* Ref.make(false)
    // `count` is the number of polls so far; the first poll observes `statuses[0]`.
    const snapshot = (count: number): GenerationSnapshot => ({
      id: "gen_1",
      status: statuses[Math.min(Math.max(count - 1, 0), statuses.length - 1)],
      progress: count / statuses.length,
    })
    const route: GenerationRoute<string> = {
      status: Ref.updateAndGet(polls, (count) => count + 1).pipe(Effect.map(snapshot)),
      result: Effect.gen(function* () {
        const count = yield* Ref.get(polls)
        const status = snapshot(count).status
        if (status === "completed") return result
        return yield* new AIError({ reason: new InvalidProviderOutputError({ message: `Generation ended ${status}` }) })
      }),
      cancel: Ref.set(cancelled, true),
    }
    return { route, polls, cancelled }
  })

describe("Generation", () => {
  it.effect("polls queued → running → completed and returns the result", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["queued", "running", "completed"], "done")
      const generation = new Generation(scripted.route, { op: "token_1" }, { id: "gen_1", status: "queued" })
      expect(generation.terminal).toBe(false)

      const fiber = yield* Effect.forkChild(generation.await({ poll: { interval: "1 second", timeout: "1 minute" } }))
      yield* TestClock.adjust("3 seconds")
      const result = yield* Fiber.join(fiber)

      expect(result).toBe("done")
      expect(yield* Ref.get(scripted.polls)).toBe(3)
    }),
  )

  it.effect("returns immediately for an already terminal generation", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["completed"], "done")
      yield* Ref.set(scripted.polls, 1)
      const generation = new Generation(scripted.route, "t", { id: "gen_1", status: "completed" })
      expect(yield* generation.await()).toBe("done")
      expect(yield* Ref.get(scripted.polls)).toBe(1)
    }),
  )

  it.effect("fails with a Timeout reason when the generation never finishes", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["running"], "never")
      const generation = new Generation(scripted.route, "t", { id: "gen_1", status: "queued" })

      const fiber = yield* Effect.forkChild(
        generation.await({ poll: { interval: "1 second", timeout: "5 seconds" } }).pipe(Effect.flip),
      )
      yield* TestClock.adjust("6 seconds")
      const error = yield* Fiber.join(fiber)

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason._tag).toBe("Timeout")
      expect(error.message).toContain("gen_1")
      expect(yield* Ref.get(scripted.polls)).toBeGreaterThan(1)
    }),
  )

  it.effect("fails an event stream at the deadline even when a status poll hangs", () =>
    Effect.gen(function* () {
      const route: GenerationRoute<string> = {
        status: Effect.never,
        result: Effect.succeed("never"),
      }
      const generation = new Generation(route, "t", { id: "gen_1", status: "queued" })

      const fiber = yield* Effect.forkChild(
        generation.events({ poll: { interval: "1 second", timeout: "5 seconds" } }).pipe(Stream.runCollect, Effect.flip),
      )
      yield* TestClock.adjust("6 seconds")
      const error = yield* Fiber.join(fiber)

      expect(error.reason._tag).toBe("Timeout")
    }),
  )

  it.effect("fails an event stream at the deadline when the poll interval is longer than the timeout", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["running"], "never")
      const generation = new Generation(scripted.route, "t", { id: "gen_1", status: "queued" })

      const fiber = yield* Effect.forkChild(
        generation
          .events({ poll: { interval: "30 seconds", timeout: "10 seconds" } })
          .pipe(Stream.runCollect, Effect.flip),
      )
      yield* TestClock.adjust("9 seconds")
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(fiber)

      expect(error.reason._tag).toBe("Timeout")
      expect(yield* Ref.get(scripted.polls)).toBe(1)
    }),
  )

  it.effect("surfaces the route failure body for failed generations", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["running", "failed"], "unused")
      const generation = new Generation(scripted.route, "t", { id: "gen_1", status: "queued" })

      const fiber = yield* Effect.forkChild(generation.await({ poll: { interval: "1 second" } }).pipe(Effect.flip))
      yield* TestClock.adjust("2 seconds")
      const error = yield* Fiber.join(fiber)

      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("Generation ended failed")
    }),
  )

  it.effect("streams status events until the first terminal observation and cancels through the route", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["queued", "running", "completed"], "done")
      const generation = new Generation(scripted.route, "t", { id: "gen_1", status: "queued" })

      const fiber = yield* Effect.forkChild(
        generation.events({ poll: { interval: "1 second" } }).pipe(Stream.runCollect),
      )
      yield* TestClock.adjust("3 seconds")
      const events = Array.from(yield* Fiber.join(fiber))

      expect(events).toEqual([
        { type: "generation-queued", id: "gen_1", position: undefined },
        { type: "generation-progress", id: "gen_1", progress: 2 / 3 },
        { type: "generation-finished", id: "gen_1", status: "completed" },
      ])

      yield* generation.cancel()
      expect(yield* Ref.get(scripted.cancelled)).toBe(true)
    }),
  )
})
