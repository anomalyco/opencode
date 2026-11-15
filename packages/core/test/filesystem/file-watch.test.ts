import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Duration, Effect, Fiber, Layer, Schedule, Stream } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { FileWatch } from "@opencode/core/filesystem/file-watch"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { FileSystem } from "@opencode/schema/filesystem"
import { AbsolutePath } from "@opencode/core/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const services = AppNodeBuilder.build(LayerNode.group([FSUtil.node, Bus.node]))
const it = testEffect(Layer.provideMerge(FileWatch.layer(), Watcher.testLayer).pipe(Layer.provideMerge(services)))
const native = testEffect(
  FileWatch.layer().pipe(
    Layer.provideMerge(Watcher.layer().pipe(Layer.provide(Watcher.nativeLayer))),
    Layer.provideMerge(services),
  ),
)
const describeNative = process.env.CI ? describe.skip : describe

const location = { directory: AbsolutePath.make("/project") }
const file = (name: string) => ({ location, file: path.join(location.directory, name) })

const subscriptions = Effect.gen(function* () {
  const test = yield* Watcher.Test
  return (yield* test.subscriptions()).length
})

describe("FileWatch", () => {
  it.effect("shares one watch per file and resubscribes after unwatch", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      yield* fileWatch.watch(file("a.ts"))
      yield* fileWatch.watch(file("a.ts"))
      expect(yield* subscriptions).toBe(1)
      yield* fileWatch.unwatch(file("a.ts"))
      yield* fileWatch.watch(file("a.ts"))
      expect(yield* subscriptions).toBe(2)
    }),
  )

  it.effect("expires a watch after 24 hours unless it is watched again", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      yield* fileWatch.watch(file("a.ts"))
      yield* fileWatch.watch(file("b.ts"))
      yield* TestClock.adjust(Duration.hours(23))
      yield* fileWatch.watch(file("a.ts"))
      yield* TestClock.adjust(Duration.hours(2))
      expect(yield* subscriptions).toBe(2)
      yield* fileWatch.watch(file("a.ts"))
      expect(yield* subscriptions).toBe(2)
      yield* fileWatch.watch(file("b.ts"))
      expect(yield* subscriptions).toBe(3)
    }),
  )

  it.effect("evicts the watch closest to expiring when a location is full", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      yield* fileWatch.watch(file("oldest.ts"))
      yield* TestClock.adjust(Duration.minutes(1))
      yield* Effect.forEach(
        Array.from({ length: FileWatch.MAX_PER_LOCATION - 1 }, (_, index) => file(`${index}.ts`)),
        (input) => fileWatch.watch(input),
        { discard: true },
      )
      yield* fileWatch.watch({ location: { directory: AbsolutePath.make("/other") }, file: "/other/a.ts" })
      expect(yield* subscriptions).toBe(FileWatch.MAX_PER_LOCATION + 1)
      yield* fileWatch.watch(file("newest.ts"))
      yield* fileWatch.watch(file("0.ts"))
      expect(yield* subscriptions).toBe(FileWatch.MAX_PER_LOCATION + 2)
      yield* fileWatch.watch(file("oldest.ts"))
      expect(yield* subscriptions).toBe(FileWatch.MAX_PER_LOCATION + 3)
    }),
  )

  it.effect("publishes filesystem.changed on the watch's location", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      const test = yield* Watcher.Test
      const bus = yield* Bus.Service
      const tmp = yield* tmpdirScoped()
      const target = path.join(tmp.path, "a.ts")
      yield* Effect.promise(() => fs.writeFile(target, "a"))
      const input = { location: { directory: AbsolutePath.make(tmp.path) }, file: target }
      const events = yield* bus
        .subscribe(FileSystem.Event.Changed)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
      yield* fileWatch.watch(input)
      yield* test.emit({ path: target, type: "update" })
      yield* Effect.promise(() => fs.rm(target))
      yield* test.emit({ path: target, type: "update" })
      const received = yield* Fiber.join(events)
      expect(received.map((event) => ({ directory: event.location?.directory, ...event.data }))).toEqual([
        { directory: AbsolutePath.make(tmp.path), file: target, event: "change" },
        { directory: AbsolutePath.make(tmp.path), file: target, event: "unlink" },
      ])
    }),
  )
})

describe("FileWatch dead watches", () => {
  const counts = { subscribes: 0 }
  // A native watch that cannot start, like one on a directory that no longer exists.
  const failing = testEffect(
    FileWatch.layer().pipe(
      Layer.provide(
        Watcher.layer().pipe(
          Layer.provide(
            Layer.succeed(
              Watcher.Native,
              Watcher.Native.of({ subscribe: () => Effect.sync(() => void counts.subscribes++) }),
            ),
          ),
        ),
      ),
      Layer.provide(services),
    ),
  )
  failing.effect("starts a new watch when the previous one ended", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      yield* fileWatch.watch(file("a.ts"))
      yield* Effect.repeat(Effect.yieldNow, { times: 10 })
      yield* fileWatch.watch(file("a.ts"))
      expect(counts.subscribes).toBe(2)
    }),
  )

  const failures = { subscribes: 0 }
  const broken = testEffect(
    FileWatch.layer().pipe(
      Layer.provide(
        Layer.succeed(
          Watcher.Service,
          Watcher.Service.of({
            subscribe: () => Effect.sync(() => (failures.subscribes++, Stream.die(new Error("watch failed")))),
          }),
        ),
      ),
      Layer.provide(services),
    ),
  )
  broken.effect("starts a new watch when the previous one failed", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      yield* fileWatch.watch(file("a.ts"))
      yield* Effect.repeat(Effect.yieldNow, { times: 10 })
      yield* fileWatch.watch(file("a.ts"))
      expect(failures.subscribes).toBe(2)
    }),
  )
})

describe("FileWatch disabled", () => {
  const disabled = testEffect(
    FileWatch.layer({ enabled: false }).pipe(Layer.provide(Watcher.testLayer), Layer.provide(services)),
  )
  disabled.effect("fails watch requests", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      const error = yield* fileWatch.watch(file("a.ts")).pipe(Effect.flip)
      expect(error).toBeInstanceOf(FileWatch.DisabledError)
    }),
  )
})

describeNative("FileWatch native", () => {
  native.live("reports in-place edits and atomic temp + rename saves", () =>
    Effect.gen(function* () {
      const fileWatch = yield* FileWatch.Service
      const bus = yield* Bus.Service
      const tmp = yield* tmpdirScoped()
      const target = path.join(tmp.path, "a.ts")
      yield* Effect.promise(() => fs.writeFile(target, "start"))
      yield* fileWatch.watch({ location: { directory: AbsolutePath.make(tmp.path) }, file: target })

      const changed = (write: () => Promise<void>) =>
        Effect.gen(function* () {
          const seen = yield* Deferred.make<void>()
          const listener = yield* bus.subscribe(FileSystem.Event.Changed).pipe(
            Stream.filter((event) => event.data.file === target && event.data.event === "change"),
            Stream.runForEach(() => Deferred.succeed(seen, undefined)),
            Effect.forkScoped({ startImmediately: true }),
          )
          // Native watches arm asynchronously, so repeat the write until one is seen.
          const writes = yield* Effect.promise(write).pipe(
            Effect.repeat(Schedule.spaced("20 millis")),
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* Deferred.await(seen).pipe(
            Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.fail(new Error("no change event")) }),
            Effect.ensuring(Fiber.interrupt(writes)),
            Effect.ensuring(Fiber.interrupt(listener)),
          )
        })

      yield* changed(() => fs.writeFile(target, `inplace-${Math.random()}`))
      yield* changed(async () => {
        const temp = path.join(tmp.path, `.a.ts.${Math.random().toString(36).slice(2)}.tmp`)
        await fs.writeFile(temp, `atomic-${Math.random()}`)
        await fs.rename(temp, target)
      })
    }),
  )
})
