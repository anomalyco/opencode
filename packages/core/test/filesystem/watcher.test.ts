import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Duration, Effect, Fiber, Layer, Option, Schedule, Stream } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigLocationWatcherPlugin } from "@opencode-ai/core/config/plugin/location-watcher"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeLocationNode, type LocationNode } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { LocationWatcher } from "@opencode-ai/core/filesystem/location-watcher"
import { LocationWatcherPolicy } from "@opencode-ai/core/filesystem/location-watcher-policy"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Document, Event, Info, type Entry } from "@opencode-ai/schema/config"
import { Location } from "@opencode-ai/core/location"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

type WatcherEvent = { file: string; event: "add" | "change" | "unlink" }
const describeNative = process.env.CI ? describe.skip : describe

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, Bus.node])))

const configLayer = Config.testLayer()
const pluginNode = makeLocationNode({
  service: PluginSupervisor.Service,
  layer: Layer.succeed(PluginSupervisor.Service, PluginSupervisor.Service.of({ flush: Effect.void })),
  deps: [],
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
      // Closing the layer scope tears the native subscription down while the
      // consumer still holds a reference; the consumer's own release as its
      // stream ends must not tear it down a second time.
      yield* Fiber.join(consumer)
      expect(counts.unsubscribes).toBe(1)
    })
  })
})

function provide(
  directory: string,
  vcs?: Location.Interface["vcs"],
  watcher?: Layer.Layer<Watcher.Service>,
  config: Layer.Layer<Config.Service> = configLayer,
  plugins: LocationNode<PluginSupervisor.Service> = pluginNode,
) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { vcs })),
  )
  const built = AppNodeBuilder.build(
    LayerNode.group([LocationWatcher.node, LocationWatcherPolicy.node, Bus.node, Config.node]),
    [
      [Config.node, config],
      [Location.node, locationLayer],
      [PluginSupervisor.node, plugins],
      ...(watcher ? ([[Watcher.node, watcher]] as const) : []),
    ],
  )
  return Effect.provide(built)
}

function withTmp<A, E, R>(
  f: (directory: string, vcs?: Location.Interface["vcs"]) => Effect.Effect<A, E, R>,
  options?: {
    vcs?: "git" | "hg"
    init?: (directory: string) => Promise<void>
    watcher?: Layer.Layer<Watcher.Service>
    config?: Layer.Layer<Config.Service>
    plugins?: LocationNode<PluginSupervisor.Service>
  },
) {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const tmp = await tmpdir()
      if (options?.vcs === "hg") {
        await fs.mkdir(path.join(tmp.path, ".hg"))
        return { tmp, vcs: { type: "hg" as const, store: AbsolutePath.make(path.join(tmp.path, ".hg")) } }
      }
      if (options?.vcs !== "git") return { tmp, vcs: undefined }
      await $`git init`.cwd(tmp.path).quiet()
      await $`git config core.fsmonitor false`.cwd(tmp.path).quiet()
      await $`git config commit.gpgsign false`.cwd(tmp.path).quiet()
      await $`git config user.email test@opencode.test`.cwd(tmp.path).quiet()
      await $`git config user.name Test`.cwd(tmp.path).quiet()
      await $`git commit --allow-empty -m root`.cwd(tmp.path).quiet()
      await options.init?.(tmp.path)
      return { tmp, vcs: { type: "git" as const, store: AbsolutePath.make(path.join(tmp.path, ".git")) } }
    }),
    ({ tmp }) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ tmp, vcs }) =>
      f(tmp.path, vcs).pipe(provide(tmp.path, vcs, options?.watcher, options?.config ?? configLayer, options?.plugins)),
    ),
  )
}

describe("LocationWatcher subscriptions", () => {
  it.live("watches only exact Git branch metadata", () => {
    const subscriptions: Watcher.WatchInput[] = []
    const watcher = Layer.succeed(
      Watcher.Service,
      Watcher.Service.of({
        subscribe: (input) => Effect.sync(() => subscriptions.push(input)).pipe(Effect.as(Stream.empty)),
      }),
    )
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          yield* LocationWatcher.Service
          yield* Effect.sync(() => subscriptions.length).pipe(
            Effect.filterOrFail((count) => count > 0),
            Effect.retry(Schedule.spaced("10 millis")),
          )
          yield* Effect.sleep("10 millis")
          expect(subscriptions).toEqual([{ path: path.join(directory, ".git", "HEAD"), type: "file" }])
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("watches only exact Hg branch metadata", () => {
    const subscriptions: Watcher.WatchInput[] = []
    const watcher = Layer.succeed(
      Watcher.Service,
      Watcher.Service.of({
        subscribe: (input) => Effect.sync(() => subscriptions.push(input)).pipe(Effect.as(Stream.empty)),
      }),
    )
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          yield* LocationWatcher.Service
          yield* Effect.sync(() => subscriptions.length).pipe(
            Effect.filterOrFail((count) => count > 0),
            Effect.retry(Schedule.spaced("10 millis")),
          )
          yield* Effect.sleep("10 millis")
          expect(subscriptions).toEqual([{ path: path.join(directory, ".hg", "branch"), type: "file" }])
        }),
      { vcs: "hg", watcher },
    )
  })

  it.live("reconciles config without duplicate subscriptions", () => {
    const entries = { current: [] as Entry[] }
    const subscriptions: Watcher.WatchInput[] = []
    const counts = { active: 0, released: 0 }
    const watcher = Layer.succeed(
      Watcher.Service,
      Watcher.Service.of({
        subscribe: (input) =>
          Effect.sync(() => {
            subscriptions.push(input)
            counts.active++
            return Stream.never.pipe(
              Stream.ensuring(
                Effect.sync(() => {
                  counts.active--
                  counts.released++
                }),
              ),
            )
          }),
      }),
    )
    const config = Layer.succeed(
      Config.Service,
      Config.Service.of({
        entries: () => Effect.sync(() => entries.current),
        changes: () => Stream.never,
      }),
    )
    return Effect.gen(function* () {
      yield* withTmp(
        () =>
          Effect.gen(function* () {
            const policy = yield* LocationWatcherPolicy.Service
            const bus = yield* Bus.Service
            yield* Effect.sync(() => subscriptions.length).pipe(
              Effect.filterOrFail((count) => count === 1),
              Effect.retry(Schedule.spaced("10 millis")),
            )
            expect(counts.active).toBe(1)

            entries.current = [new Document({ type: "document", info: new Info({ watcher: { ignore: [".git"] } }) })]
            yield* ConfigLocationWatcherPlugin.Plugin.effect(
              host({ event: { subscribe: () => bus.subscribe(Event.Updated) } }),
            )
            yield* Effect.sync(() => counts.active).pipe(
              Effect.filterOrFail((count) => count === 0),
              Effect.retry(Schedule.spaced("10 millis")),
            )
            expect(counts.released).toBe(1)

            entries.current = []
            yield* bus.publish(Event.Updated, {})
            yield* Effect.sync(() => subscriptions.length).pipe(
              Effect.filterOrFail((count) => count === 2),
              Effect.retry(Schedule.spaced("10 millis")),
            )
            expect(counts.active).toBe(1)

            yield* policy.reload()
            expect(subscriptions).toHaveLength(2)
          }),
        { vcs: "git", watcher, config },
      )
      expect(counts.active).toBe(0)
      expect(counts.released).toBe(2)
    })
  })

  it.live("does not start before configured policy is ready", () => {
    const subscriptions: Watcher.WatchInput[] = []
    const watcher = Layer.succeed(
      Watcher.Service,
      Watcher.Service.of({
        subscribe: (input) => Effect.sync(() => subscriptions.push(input)).pipe(Effect.as(Stream.never)),
      }),
    )
    const plugins = makeLocationNode({
      service: PluginSupervisor.Service,
      layer: Layer.effect(
        PluginSupervisor.Service,
        Effect.gen(function* () {
          const policy = yield* LocationWatcherPolicy.Service
          yield* policy.transform((draft) => draft.add([".git"]))
          return PluginSupervisor.Service.of({ flush: Effect.void })
        }),
      ),
      deps: [LocationWatcherPolicy.node],
    })
    return withTmp(
      () =>
        Effect.gen(function* () {
          yield* LocationWatcher.Service
          yield* Effect.sleep("50 millis")
          expect(subscriptions).toEqual([])
        }),
      { vcs: "git", watcher, plugins },
    )
  })
})

function wait(check: (event: WatcherEvent) => boolean) {
  return Effect.gen(function* () {
    const bus = yield* Bus.Service
    const deferred = yield* Deferred.make<WatcherEvent>()
    const fiber = yield* bus.subscribe(FileSystem.Event.Changed).pipe(
      Stream.runForEach((event) => {
        if (!check(event.data)) return Effect.void
        return Deferred.succeed(deferred, event.data).pipe(Effect.asVoid)
      }),
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    return { deferred, fiber }
  })
}

function maybeNextUpdate<E>(
  check: (event: WatcherEvent) => boolean,
  trigger: Effect.Effect<void, E>,
  timeout: Duration.Input = "5 seconds",
) {
  return Effect.acquireUseRelease(
    wait(check),
    ({ deferred }) => trigger.pipe(Effect.andThen(Deferred.await(deferred)), Effect.timeoutOption(timeout)),
    ({ fiber }) => Fiber.interrupt(fiber),
  )
}

function nextUpdate<E>(check: (event: WatcherEvent) => boolean, trigger: Effect.Effect<void, E>) {
  return Effect.gen(function* () {
    const result = yield* maybeNextUpdate(check, trigger)
    if (Option.isSome(result)) return result.value
    return yield* Effect.fail(new Error("timed out waiting for file watcher update"))
  })
}

function eventuallyUpdate<E>(check: (event: WatcherEvent) => boolean, trigger: () => Effect.Effect<void, E>) {
  return Effect.gen(function* () {
    while (true) {
      const result = yield* maybeNextUpdate(check, trigger(), "250 millis")
      if (Option.isSome(result)) return result.value
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timed out waiting for file watcher readiness")),
    }),
  )
}

function ready(file: string, eventFile = file) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const content = (yield* fs.readFileStringSafe(file)) ?? `ready-${Math.random()}`
    yield* eventuallyUpdate(
      (event) => event.file === eventFile,
      () => fs.writeFileString(file, content),
    ).pipe(Effect.asVoid)
  })
}

describeNative("LocationWatcher", () => {
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

  it.live("publishes .git/HEAD events", () =>
    withTmp(
      (directory) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const head = path.join(directory, ".git", "HEAD")
          const branch = `watch-${Math.random().toString(36).slice(2)}`
          yield* ready(head)
          yield* Effect.promise(() => $`git branch ${branch}`.cwd(directory).quiet())
          expect(
            yield* nextUpdate((event) => event.file === head, fs.writeFileString(head, `ref: refs/heads/${branch}\n`)),
          ).toEqual({ file: head, event: "change" })
        }),
      { vcs: "git" },
    ),
  )

  const describeSymlink = process.platform !== "win32" ? describe : describe.skip
  describeSymlink("symlinked .git", () => {
    it.live("publishes .git/HEAD events through a symlinked .git directory", () =>
      withTmp(
        (directory) =>
          Effect.gen(function* () {
            const afs = yield* FSUtil.Service
            const actual = path.join(directory, "..", `actual_${path.basename(directory)}`)
            yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(actual, { recursive: true, force: true })))
            const head = path.join(directory, ".git", "HEAD")
            yield* ready(head, path.join(actual, "HEAD"))
            const branch = `watch-${Math.random().toString(36).slice(2)}`
            yield* Effect.promise(() => $`git branch ${branch}`.cwd(directory).quiet())
            expect(
              yield* nextUpdate(
                (event) => event.file === path.join(actual, "HEAD"),
                afs.writeFileString(head, `ref: refs/heads/${branch}\n`),
              ),
            ).toEqual({ file: path.join(actual, "HEAD"), event: "change" })
          }),
        {
          vcs: "git",
          init: async (directory) => {
            const actual = path.join(directory, "..", `actual_${path.basename(directory)}`)
            await fs.rename(path.join(directory, ".git"), actual)
            await fs.symlink(actual, path.join(directory, ".git"))
          },
        },
      ),
    )
  })

  it.live("publishes .hg/branch events", () =>
    withTmp(
      (directory) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const branch = path.join(directory, ".hg", "branch")
          yield* ready(branch)
          expect(
            yield* nextUpdate((event) => event.file === branch, fs.writeFileString(branch, "feature\n")),
          ).toMatchObject({ file: branch })
        }),
      { vcs: "hg" },
    ),
  )
})
