import { expect } from "bun:test"
import { Effect, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../../core/test/lib/effect"
import { Updater } from "../src/services/updater"

const it = testEffect(Layer.empty)

it.effect("checks at startup and every 10 minutes, reporting only changed results", () =>
  Effect.gen(function* () {
    const responses: Array<Updater.RunResult | undefined> = [
      undefined,
      { type: "available", version: "1.2.4" },
      { type: "available", version: "1.2.4" },
      { type: "available", version: "1.2.5" },
    ]
    const checks = yield* Queue.unbounded<void>()
    const updates = yield* Updater.poll(
      Queue.offer(checks, undefined).pipe(Effect.andThen(Effect.sync(() => responses.shift()))),
      "10 minutes",
    )
    const reported = yield* Queue.unbounded<Updater.RunResult>()
    yield* updates.changes.pipe(
      Stream.runForEach((result) => Queue.offer(reported, result)),
      Effect.forkScoped,
    )

    yield* Queue.take(checks)
    yield* updates.checked
    yield* TestClock.adjust("9 minutes")
    expect(yield* Queue.size(checks)).toBe(0)

    yield* TestClock.adjust("1 minute")
    yield* Queue.take(checks)
    expect(yield* Queue.take(reported)).toEqual({ type: "available", version: "1.2.4" })

    yield* TestClock.adjust("10 minutes")
    yield* Queue.take(checks)
    yield* TestClock.adjust("10 minutes")
    yield* Queue.take(checks)
    expect(yield* Queue.take(reported)).toEqual({ type: "available", version: "1.2.5" })
    expect(yield* Queue.size(reported)).toBe(0)
  }),
)

it.effect("replays the latest result to late subscribers", () =>
  Effect.gen(function* () {
    const updates = yield* Updater.poll(Effect.succeed({ type: "installed", version: "1.2.4" }), "10 minutes")
    yield* updates.checked
    expect(yield* updates.changes.pipe(Stream.take(1), Stream.runCollect)).toEqual([
      { type: "installed", version: "1.2.4" },
    ])
  }),
)
