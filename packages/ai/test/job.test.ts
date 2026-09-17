import { describe, expect } from "bun:test"
import { Effect, Fiber, Ref, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import {
  AIError,
  InvalidProviderOutputError,
  Job,
  type JobRoute,
  type JobSnapshot,
  type JobStatus,
} from "../src/index.js"
import { it } from "./lib/effect.js"

/** In-memory job route whose status advances through `statuses` on every poll. */
const scriptedRoute = (statuses: ReadonlyArray<JobStatus>, result: string) =>
  Effect.gen(function* () {
    const polls = yield* Ref.make(0)
    const cancelled = yield* Ref.make(false)
    // `count` is the number of polls so far; the first poll observes `statuses[0]`.
    const snapshot = (count: number): JobSnapshot => ({
      id: "job_1",
      status: statuses[Math.min(Math.max(count - 1, 0), statuses.length - 1)],
      progress: count / statuses.length,
    })
    const route: JobRoute<string> = {
      status: () => Ref.updateAndGet(polls, (count) => count + 1).pipe(Effect.map(snapshot)),
      result: (token) =>
        Effect.gen(function* () {
          const count = yield* Ref.get(polls)
          const status = snapshot(count).status
          if (status === "completed") return `${result}:${String(token)}`
          return yield* new AIError({ reason: new InvalidProviderOutputError({ message: `Job ended ${status}` }) })
        }),
      cancel: () => Ref.set(cancelled, true),
    }
    return { route, polls, cancelled }
  })

describe("Job", () => {
  it.effect("polls queued → running → completed and returns the result", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["queued", "running", "completed"], "done")
      const job = new Job(scripted.route, { op: "token_1" }, { id: "job_1", status: "queued" })
      expect(job.terminal).toBe(false)

      const fiber = yield* Effect.forkChild(job.await({ poll: { interval: "1 second", timeout: "1 minute" } }))
      yield* TestClock.adjust("3 seconds")
      const result = yield* Fiber.join(fiber)

      expect(result).toBe("done:[object Object]")
      expect(yield* Ref.get(scripted.polls)).toBe(3)
    }),
  )

  it.effect("returns immediately for an already terminal job", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["completed"], "done")
      yield* Ref.set(scripted.polls, 1)
      const job = new Job(scripted.route, "t", { id: "job_1", status: "completed" })
      expect(yield* job.await()).toBe("done:t")
      expect(yield* Ref.get(scripted.polls)).toBe(1)
    }),
  )

  it.effect("fails with a Timeout reason when the job never finishes", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["running"], "never")
      const job = new Job(scripted.route, "t", { id: "job_1", status: "queued" })

      const fiber = yield* Effect.forkChild(
        job.await({ poll: { interval: "1 second", timeout: "5 seconds" } }).pipe(Effect.flip),
      )
      yield* TestClock.adjust("6 seconds")
      const error = yield* Fiber.join(fiber)

      expect(error).toBeInstanceOf(AIError)
      expect(error.reason._tag).toBe("Timeout")
      expect(error.message).toContain("job_1")
      expect(yield* Ref.get(scripted.polls)).toBeGreaterThan(1)
    }),
  )

  it.effect("surfaces the route failure body for failed jobs", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["running", "failed"], "unused")
      const job = new Job(scripted.route, "t", { id: "job_1", status: "queued" })

      const fiber = yield* Effect.forkChild(job.await({ poll: { interval: "1 second" } }).pipe(Effect.flip))
      yield* TestClock.adjust("2 seconds")
      const error = yield* Fiber.join(fiber)

      expect(error.reason._tag).toBe("InvalidProviderOutput")
      expect(error.message).toContain("Job ended failed")
    }),
  )

  it.effect("streams status events until the first terminal observation and cancels through the route", () =>
    Effect.gen(function* () {
      const scripted = yield* scriptedRoute(["queued", "running", "completed"], "done")
      const job = new Job(scripted.route, "t", { id: "job_1", status: "queued" })

      const fiber = yield* Effect.forkChild(job.events({ poll: { interval: "1 second" } }).pipe(Stream.runCollect))
      yield* TestClock.adjust("3 seconds")
      const events = Array.from(yield* Fiber.join(fiber))

      expect(events).toEqual([
        { type: "job-queued", id: "job_1", position: undefined },
        { type: "job-progress", id: "job_1", progress: 2 / 3 },
        { type: "job-finished", id: "job_1", status: "completed" },
      ])

      yield* job.cancel()
      expect(yield* Ref.get(scripted.cancelled)).toBe(true)
    }),
  )
})
