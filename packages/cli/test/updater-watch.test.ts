import { expect } from "bun:test"
import { Effect, Layer, Queue } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../../core/test/lib/effect"
import { Updater } from "../src/services/updater"

const it = testEffect(Layer.empty)

it.effect("checks immediately and every 10 minutes", () =>
  Effect.gen(function* () {
    const updates = yield* Queue.unbounded<string>()
    yield* Updater.watchUpdates({
      inspect: () => Effect.succeed({ action: "upgrade", version: "2.0.0" }),
      notify: (version) => Queue.offer(updates, version).pipe(Effect.asVoid),
    }).pipe(Effect.forkScoped)

    expect(yield* Queue.take(updates)).toBe("2.0.0")
    yield* TestClock.adjust("10 minutes")
    expect(yield* Queue.take(updates)).toBe("2.0.0")
  }),
)

it.effect("does not notify when no update is available", () =>
  Effect.gen(function* () {
    const updates = yield* Queue.unbounded<string>()
    yield* Updater.watchUpdates({
      inspect: () => Effect.succeed({ action: "none" }),
      notify: (version) => Queue.offer(updates, version).pipe(Effect.asVoid),
    }).pipe(Effect.forkScoped)

    yield* Effect.yieldNow
    expect(yield* Queue.size(updates)).toBe(0)
  }),
)
