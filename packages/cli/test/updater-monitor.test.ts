import { expect } from "bun:test"
import { Effect, Layer, Queue } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../../core/test/lib/effect"
import { Updater } from "../src/services/updater"

const it = testEffect(Layer.empty)

it.effect("checks after 10 minutes and every 10 minutes after that", () =>
  Effect.gen(function* () {
    const updates = yield* Queue.unbounded<string>()
    yield* Updater.monitorUpdates({
      inspect: () => Effect.succeed("2.0.0"),
      notify: (version) => Queue.offer(updates, version).pipe(Effect.asVoid),
    }).pipe(Effect.forkScoped)

    yield* Effect.yieldNow
    expect(yield* Queue.size(updates)).toBe(0)
    yield* TestClock.adjust("10 minutes")
    expect(yield* Queue.take(updates)).toBe("2.0.0")
    yield* Effect.yieldNow
    yield* TestClock.adjust("10 minutes")
    expect(yield* Queue.take(updates)).toBe("2.0.0")
  }),
)

it.effect("does not notify when no update is available", () =>
  Effect.gen(function* () {
    const updates = yield* Queue.unbounded<string>()
    yield* Updater.monitorUpdates({
      inspect: () => Effect.succeed(undefined),
      notify: (version) => Queue.offer(updates, version).pipe(Effect.asVoid),
    }).pipe(Effect.forkScoped)

    yield* Effect.yieldNow
    expect(yield* Queue.size(updates)).toBe(0)
  }),
)
