import { describe, expect } from "bun:test"
import path from "path"
import { Deferred, Effect, Fiber, Layer, Schedule, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const describeNative = process.env.CI ? describe.skip : describe

const it = testEffect(AppNodeBuilder.build(FSUtil.node))

describe("Watcher.testLayer", () => {
  it.effect("records subscriptions and broadcasts emitted updates through the service", () =>
    Effect.gen(function* () {
      const watcher = yield* Watcher.Service
      const test = yield* Watcher.Test
      const updates = yield* watcher.subscribe({ path: "/root", type: "directory" })
      const received = yield* updates.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.yieldNow

      yield* test.emit({ type: "update", path: "/root/file.md" })

      expect(Array.from(yield* Fiber.join(received))).toEqual([{ type: "update", path: "/root/file.md" }])
      expect(yield* test.subscriptions()).toEqual([{ path: path.resolve("/root"), type: "directory" }])
    }).pipe(Effect.provide(Watcher.testLayer)),
  )
})

function withNative(native: Watcher.NativeInterface) {
  return Effect.provide(Watcher.layer().pipe(Layer.provide(Layer.succeed(Watcher.Native, native))))
}

function countingNative() {
  const counts = { subscribes: 0, unsubscribes: 0 }
  const native: Watcher.NativeInterface = {
    subscribe: () =>
      Effect.sync(() => {
        counts.subscribes++
        return {
          unsubscribe: () => {
            counts.unsubscribes++
            return Promise.resolve()
          },
        }
      }),
  }
  return { native, counts }
}

describe("Watcher lifecycle", () => {
  it.effect("interrupting a consumer interrupts a pending acquisition", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        const watcher = yield* Watcher.Service
        const consumer = yield* watcher
          .subscribe({ path: "/pending", type: "directory" })
          .pipe(Effect.flatMap(Stream.runDrain), Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(started)
        yield* Fiber.interrupt(consumer)
        expect(yield* Deferred.isDone(interrupted)).toBe(true)
      }).pipe(
        withNative({
          subscribe: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        }),
      )
    }),
  )

  it.effect("shares one subscription and releases exactly once after the final consumer", () => {
    const { native, counts } = countingNative()
    return Effect.gen(function* () {
      const watcher = yield* Watcher.Service
      const consume = () =>
        watcher
          .subscribe({ path: "/shared", type: "directory" })
          .pipe(Effect.flatMap(Stream.runDrain), Effect.forkScoped({ startImmediately: true }))
      const first = yield* consume()
      const second = yield* consume()
      yield* Effect.yieldNow
      expect(counts.subscribes).toBe(1)

      yield* Fiber.interrupt(first)
      expect(counts.unsubscribes).toBe(0)

      yield* Fiber.interrupt(second)
      expect(counts.subscribes).toBe(1)
      expect(counts.unsubscribes).toBe(1)
    }).pipe(withNative(native))
  })

  it.effect("scope shutdown releases an active subscription exactly once", () => {
    const { native, counts } = countingNative()
    return Effect.gen(function* () {
      const consumer = yield* Effect.gen(function* () {
        const watcher = yield* Watcher.Service
        const updates = yield* watcher.subscribe({ path: "/active", type: "directory" })
        const consumer = yield* updates.pipe(Stream.runDrain, Effect.forkScoped({ startImmediately: true }))
        yield* Effect.yieldNow
        expect(counts.subscribes).toBe(1)
        expect(counts.unsubscribes).toBe(0)
        return consumer
      }).pipe(withNative(native))
      yield* Fiber.join(consumer)
      expect(counts.unsubscribes).toBe(1)
    })
  })
})

function withTmp<A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => f(tmp.path)))
}

describeNative("Watcher", () => {
  it.live("limits file watches to the exact target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const watcher = yield* Watcher.Service
        const target = path.join(directory, "opencode.json")
        const sibling = path.join(directory, "other.json")
        const updates = yield* watcher.subscribe({ path: target, type: "file" })
        const update = yield* updates.pipe(
          Stream.take(1),
          Stream.runHead,
          Effect.forkScoped({ startImmediately: true }),
        )
        yield* fs.writeFileString(sibling, "sibling")
        const writes = yield* Effect.suspend(() => fs.writeFileString(target, `target-${Math.random()}`)).pipe(
          Effect.repeat(Schedule.spaced("10 millis")),
          Effect.forkScoped,
        )
        const event = yield* Fiber.join(update).pipe(Effect.ensuring(Fiber.interrupt(writes)))

        expect(event.valueOrUndefined?.path).toBe(target)
      }).pipe(Effect.provide(AppNodeBuilder.build(Watcher.node))),
    ),
  )

  it.live("detects creation of a missing directory target", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const watcher = yield* Watcher.Service
        const target = path.join(directory, "generated")
        const updates = yield* watcher.subscribe({ path: target, type: "file" })
        const update = yield* updates.pipe(
          Stream.take(1),
          Stream.runHead,
          Effect.forkScoped({ startImmediately: true }),
        )
        const creates = yield* Effect.suspend(() =>
          fs.remove(target, { recursive: true, force: true }).pipe(Effect.andThen(fs.ensureDir(target))),
        ).pipe(Effect.repeat(Schedule.spaced("10 millis")), Effect.forkScoped)
        const event = yield* Fiber.join(update).pipe(Effect.ensuring(Fiber.interrupt(creates)))

        expect(event.valueOrUndefined?.path).toBe(target)
      }).pipe(Effect.provide(AppNodeBuilder.build(Watcher.node))),
    ),
  )
})
