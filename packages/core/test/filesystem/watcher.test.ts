import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Duration, Effect, Fiber, Layer, Logger, Option, Queue, Schedule, Stream } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigLocationWatcherPlugin } from "@opencode/core/config/plugin/location-watcher"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { FSUtil } from "@opencode/util/fs-util"
import { LocationWatcher } from "@opencode/core/filesystem/location-watcher"
import { LocationWatcherPolicy } from "@opencode/core/filesystem/location-watcher-policy"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { FileSystem } from "@opencode/schema/filesystem"
import { Document, Event, Info, type Entry } from "@opencode/schema/config"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { AbsolutePath } from "@opencode/core/schema"
import { initRepo } from "../fixture/git"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

type WatcherEvent = { file: string; event: "add" | "change" | "unlink" }
const describeNative = process.env.CI ? describe.skip : describe

const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, Bus.node])))

const configLayer = Config.testLayer()

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
  it.live("ends the stream without logging an error when the watched directory is missing", () => {
    const errors: unknown[] = []
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Error") errors.push(message)
    })
    return withTmp((directory) =>
      Effect.gen(function* () {
        const watcher = yield* Watcher.Service
        const updates = yield* watcher.subscribe({ path: path.join(directory, "missing", "a.ts"), type: "file" })
        expect(Option.isNone(yield* Stream.runHead(updates))).toBe(true)
        expect(errors).toEqual([])
      }).pipe(Effect.provide(AppNodeBuilder.build(Watcher.node)), Effect.provide(Logger.layer([logger]))),
    )
  })

  it.live("still logs an error when watching fails for a reason other than ENOENT", () => {
    const errors: unknown[] = []
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Error") errors.push(message)
    })
    return withTmp((directory) =>
      Effect.gen(function* () {
        const watcher = yield* Watcher.Service
        const updates = yield* watcher.subscribe({
          path: path.join(directory, "bad\0dir", "a.ts"),
          type: "file",
        })
        expect(Option.isNone(yield* Stream.runHead(updates))).toBe(true)
        expect(errors).toHaveLength(1)
      }).pipe(Effect.provide(AppNodeBuilder.build(Watcher.node)), Effect.provide(Logger.layer([logger]))),
    )
  })

  it.effect("signals readiness after acquisition and buffers updates published by the ready callback", () =>
    Effect.gen(function* () {
      const publish = yield* Deferred.make<(update: Watcher.Update) => void>()
      const acquired = yield* Deferred.make<void>()
      const counts = { ready: 0, closed: 0 }
      yield* Effect.gen(function* () {
        const watcher = yield* Watcher.Service
        const consumer = yield* watcher
          .subscribe(
            { path: "/shared", type: "entries", names: ["opencode.json"] },
            Effect.gen(function* () {
              counts.ready++
              const notify = yield* Deferred.await(publish)
              notify({ path: "/shared/opencode.json", type: "create" })
            }),
          )
          .pipe(Effect.flatMap(Stream.runHead), Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(publish)
        expect(counts.ready).toBe(0)
        yield* Deferred.succeed(acquired, undefined)
        expect(Option.getOrUndefined(yield* Fiber.join(consumer))).toEqual({
          path: "/shared/opencode.json",
          type: "create",
        })
        expect(counts).toEqual({ ready: 1, closed: 1 })
      }).pipe(
        withNative({
          subscribe: (input) =>
            Deferred.succeed(publish, input.publish).pipe(
              Effect.andThen(Deferred.await(acquired)),
              Effect.as({
                unsubscribe: async () => {
                  counts.closed++
                },
              }),
            ),
        }),
      )
    }),
  )

  it.effect("does not signal readiness for an unavailable native watch", () => {
    const counts = { ready: 0 }
    return Effect.gen(function* () {
      const watcher = yield* Watcher.Service
      const stream = yield* watcher.subscribe(
        { path: "/unavailable", type: "directory" },
        Effect.sync(() => {
          counts.ready++
        }),
      )
      yield* Stream.runDrain(stream)
      expect(counts.ready).toBe(0)
    }).pipe(withNative({ subscribe: () => Effect.undefined }))
  })

  it.live("watches only named immediate entries, including missing directories", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const native = yield* Watcher.Native
          const events: Watcher.Update[] = []
          yield* Effect.acquireRelease(
            native.subscribe({
              type: "entries",
              target: tmp.path,
              names: ["opencode.json", ".opencode"],
              ignore: [],
              publish: (update) => events.push(update),
            }),
            (subscription) => Effect.promise(() => subscription?.unsubscribe() ?? Promise.resolve()),
          )
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "nested"))
            await fs.writeFile(path.join(tmp.path, "nested", "opencode.json"), "ignored")
            await fs.writeFile(path.join(tmp.path, "opencode.jsonc"), "ignored")
            await fs.writeFile(path.join(tmp.path, "opencode.json"), "first")
          })
          yield* Effect.sync(() => events.length).pipe(
            Effect.filterOrFail((count) => count > 0),
            Effect.retry(Schedule.spaced("10 millis")),
            Effect.timeout("1 second"),
          )
          expect(events.every((update) => update.path === path.join(tmp.path, "opencode.json"))).toBe(true)
          yield* Effect.sleep("10 millis")
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, ".opencode")))
          yield* Effect.sync(() => events.some((update) => update.path === path.join(tmp.path, ".opencode"))).pipe(
            Effect.filterOrFail(Boolean),
            Effect.retry(Schedule.spaced("10 millis")),
            Effect.timeout("1 second"),
          )
        }).pipe(Effect.provide(Watcher.nativeLayer)),
      ),
    ),
  )

  it.effect("interrupting a consumer interrupts a pending acquisition", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const counts = { ready: 0 }
      yield* Effect.gen(function* () {
        const watcher = yield* Watcher.Service
        const consumer = yield* watcher
          .subscribe(
            { path: "/pending", type: "directory" },
            Effect.sync(() => {
              counts.ready++
            }),
          )
          .pipe(Effect.flatMap(Stream.runDrain), Effect.forkScoped({ startImmediately: true }))
        yield* Deferred.await(started)
        yield* Fiber.interrupt(consumer)
        expect(yield* Deferred.isDone(interrupted)).toBe(true)
        expect(counts.ready).toBe(0)
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

  it.effect("shares equivalent entry sets and releases exactly once after the final consumer", () => {
    const { native, counts } = countingNative()
    return Effect.gen(function* () {
      const watcher = yield* Watcher.Service
      const consume = (names: string[]) =>
        watcher
          .subscribe({ path: "/shared", type: "entries", names })
          .pipe(Effect.flatMap(Stream.runDrain), Effect.forkScoped({ startImmediately: true }))
      const first = yield* consume(["opencode.json", ".opencode", "opencode.json"])
      const second = yield* consume([".opencode", "opencode.json"])
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
  plugins?: LayerNode.Replacement,
  replacements: LayerNode.Replacements = [],
) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { vcs })),
  )
  const built = AppNodeBuilder.build(
    LayerNode.group([PluginSupervisor.node, LocationWatcher.node, LocationWatcherPolicy.node, Bus.node, Config.node]),
    [
      Config.node.replace(config),
      Location.node.replace(locationLayer),
      plugins ?? PluginSupervisor.node.replace(Layer.empty),
      ...(watcher ? ([Watcher.node.replace(watcher)] as const) : []),
      ...replacements,
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
    plugins?: LayerNode.Replacement
    replacements?: LayerNode.Replacements
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
      await initRepo(tmp.path)
      await options.init?.(tmp.path)
      return { tmp, vcs: { type: "git" as const, store: AbsolutePath.make(path.join(tmp.path, ".git")) } }
    }),
    ({ tmp }) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ tmp, vcs }) =>
      f(tmp.path, vcs).pipe(
        provide(
          tmp.path,
          vcs,
          options?.watcher,
          options?.config ?? configLayer,
          options?.plugins,
          options?.replacements,
        ),
      ),
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
            Effect.timeout("5 seconds"),
          )
          yield* Effect.sleep("10 millis")
          const ref = yield* Effect.promise(() => $`git symbolic-ref HEAD`.cwd(directory).text())
          expect(subscriptions).toEqual([
            { path: path.join(directory, ".git", "HEAD"), type: "file" },
            { path: path.join(directory, ".git", ref.trimEnd()), type: "file" },
          ])
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("follows the branch ref that HEAD points at", () => {
    const { watcher, subscriptions, released, offer } = queuedWatcher()
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const gitdir = path.join(directory, ".git")
          const head = path.join(gitdir, "HEAD")
          const setHead = (content: string) =>
            nextUpdate(
              (event) => event.file === head,
              fs.writeFileString(head, content).pipe(Effect.andThen(offer(head))),
            )
          yield* LocationWatcher.Service
          yield* until(() => subscriptions.length === 2)
          const initial = path.join(
            gitdir,
            (yield* Effect.promise(() => $`git symbolic-ref HEAD`.cwd(directory).text())).trimEnd(),
          )
          expect(subscriptions).toEqual([
            { path: head, type: "file" },
            { path: initial, type: "file" },
          ])

          yield* Effect.promise(() => $`git branch review/topic`.cwd(directory).quiet())
          const switched = path.join(gitdir, "refs", "heads", "review", "topic")
          expect(yield* setHead("ref: refs/heads/review/topic\r\n")).toEqual({ file: head, event: "change" })
          yield* until(() => subscriptions.length === 3 && released.length === 1)
          expect(subscriptions[2]).toEqual({ path: switched, type: "file" })
          expect(released).toEqual([initial])

          expect(yield* nextUpdate((event) => event.file === switched, offer(switched))).toEqual({
            file: switched,
            event: "change",
          })

          const detached = yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(directory).text())
          yield* setHead(detached)
          yield* until(() => released.length === 2)

          // The ref update and the detached HEAD added no subscription: the next symbolic HEAD is the fourth.
          yield* Effect.promise(() => $`git branch after/detached`.cwd(directory).quiet())
          const after = path.join(gitdir, "refs", "heads", "after", "detached")
          yield* setHead("ref: refs/heads/after/detached\n")
          yield* until(() => subscriptions.length === 4 && released.length === 2)
          expect(subscriptions).toEqual([
            { path: head, type: "file" },
            { path: initial, type: "file" },
            { path: switched, type: "file" },
            { path: after, type: "file" },
          ])
          expect(released).toEqual([initial, switched])
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("adds no ref watch for a HEAD that names no branch in the repository", () => {
    const { watcher, subscriptions, released, offer } = queuedWatcher()
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const gitdir = path.join(directory, ".git")
          const head = path.join(gitdir, "HEAD")
          const setHead = (content: string) =>
            nextUpdate(
              (event) => event.file === head,
              fs.writeFileString(head, content).pipe(Effect.andThen(offer(head))),
            )
          yield* LocationWatcher.Service
          yield* until(() => subscriptions.length === 2)
          const initial = path.join(
            gitdir,
            (yield* Effect.promise(() => $`git symbolic-ref HEAD`.cwd(directory).text())).trimEnd(),
          )

          yield* Effect.promise(() => $`git branch after/crafted`.cwd(directory).quiet())

          // A symbolic HEAD outside refs/heads names no branch to follow.
          yield* setHead("ref: refs/tags/v1\n")
          // A crafted HEAD naming a path outside the common directory adds no ref watch either.
          yield* setHead("ref: refs/heads/../../../outside\n")
          // Both were read before the next HEAD, whose ref is the only subscription after them.
          const after = path.join(gitdir, "refs", "heads", "after", "crafted")
          yield* setHead("ref: refs/heads/after/crafted\n")
          yield* until(() => subscriptions.length === 3 && released.length === 1)
          expect(subscriptions).toEqual([
            { path: head, type: "file" },
            { path: initial, type: "file" },
            { path: after, type: "file" },
          ])
          expect(released).toEqual([initial])
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("watches the folder of a packed nested branch until its ref exists", () => {
    const { watcher, subscriptions, released, offer } = queuedWatcher()
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const policy = yield* LocationWatcherPolicy.Service
          const bus = yield* Bus.Service
          const fs = yield* FSUtil.Service
          const gitdir = path.join(directory, ".git")
          const head = path.join(gitdir, "HEAD")
          const folder = path.join(gitdir, "refs", "heads", "feat")
          const ref = path.join(folder, "packed")
          const changes: WatcherEvent[] = []
          yield* bus.subscribe(FileSystem.Event.Changed).pipe(
            Stream.runForEach((event) => Effect.sync(() => changes.push(event.data))),
            Effect.forkScoped,
          )
          const setHead = (content: string) =>
            nextUpdate(
              (event) => event.file === head,
              fs.writeFileString(head, content).pipe(Effect.andThen(offer(head))),
            )
          // `git pack-refs` keeps the packed refs and removes the folder of a nested branch name.
          yield* Effect.promise(() => $`git branch feat/packed`.cwd(directory).quiet())
          yield* Effect.promise(() => $`git pack-refs --all`.cwd(directory).quiet())
          yield* LocationWatcher.Service
          yield* until(() => subscriptions.length === 2)
          const initial = path.join(
            gitdir,
            (yield* Effect.promise(() => $`git symbolic-ref HEAD`.cwd(directory).text())).trimEnd(),
          )
          expect(subscriptions).toEqual([
            { path: head, type: "file" },
            { path: initial, type: "file" },
          ])

          expect(yield* setHead("ref: refs/heads/feat/packed\n")).toEqual({ file: head, event: "change" })
          yield* until(() => subscriptions.length === 3 && released.length === 1)
          // The ref file does not exist, so the missing folder is watched in its place.
          expect(subscriptions[2]).toEqual({ path: folder, type: "file" })
          expect(released).toEqual([initial])

          // A commit creates the folder and the ref before the folder event is handled.
          yield* Effect.promise(() => $`git commit --allow-empty -m packed`.cwd(directory).quiet())
          expect(yield* nextUpdate((event) => event.file === ref, offer(folder))).toEqual({
            file: ref,
            event: "change",
          })
          yield* until(() => subscriptions.length === 4 && released.length === 2)
          expect(subscriptions[3]).toEqual({ path: ref, type: "file" })
          expect(released).toEqual([initial, folder])

          // Once the ref exists its own watch sees the later commits, and a reconcile reports nothing more.
          expect(yield* nextUpdate((event) => event.file === ref, offer(ref))).toEqual({
            file: ref,
            event: "change",
          })
          yield* policy.reload()
          expect(subscriptions).toHaveLength(4)
          // The folder event alone is no change of the ref.
          expect(changes.filter((event) => event.file === folder)).toEqual([])
          expect(changes.filter((event) => event.file === ref)).toHaveLength(2)
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("sees a packed nested branch appear once its folder exists", () => {
    const { watcher, subscriptions, released, offer } = queuedWatcher()
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const policy = yield* LocationWatcherPolicy.Service
          const bus = yield* Bus.Service
          const fs = yield* FSUtil.Service
          const gitdir = path.join(directory, ".git")
          const head = path.join(gitdir, "HEAD")
          const folder = path.join(gitdir, "refs", "heads", "feat")
          const ref = path.join(folder, "packed")
          const changes: WatcherEvent[] = []
          yield* bus.subscribe(FileSystem.Event.Changed).pipe(
            Stream.runForEach((event) => Effect.sync(() => changes.push(event.data))),
            Effect.forkScoped,
          )
          yield* Effect.promise(() => $`git branch feat/packed`.cwd(directory).quiet())
          yield* Effect.promise(() => $`git pack-refs --all`.cwd(directory).quiet())
          yield* LocationWatcher.Service
          yield* until(() => subscriptions.length === 2)
          yield* nextUpdate(
            (event) => event.file === head,
            fs.writeFileString(head, "ref: refs/heads/feat/packed\n").pipe(Effect.andThen(offer(head))),
          )
          yield* until(() => subscriptions.length === 3 && released.length === 1)

          // The folder appears first: the ref is then watched directly while its file is still missing.
          yield* fs.ensureDir(folder)
          yield* until(() => subscriptions.length === 4 && released.length === 2, offer(folder))
          expect(subscriptions[3]).toEqual({ path: ref, type: "file" })
          expect(changes.filter((event) => event.file !== head)).toEqual([])

          yield* Effect.promise(() => $`git commit --allow-empty -m packed`.cwd(directory).quiet())
          expect(yield* nextUpdate((event) => event.file === ref, offer(ref))).toEqual({
            file: ref,
            event: "change",
          })
          // Its own watch saw the change, so a reconcile reports nothing more.
          yield* policy.reload()
          expect(changes.filter((event) => event.file === ref)).toHaveLength(1)
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("reports no change for a ref that appeared while it was not followed", () => {
    const { watcher, subscriptions, released, offer } = queuedWatcher()
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const bus = yield* Bus.Service
          const fs = yield* FSUtil.Service
          const gitdir = path.join(directory, ".git")
          const head = path.join(gitdir, "HEAD")
          const folder = path.join(gitdir, "refs", "heads", "feat")
          const ref = path.join(folder, "packed")
          const changes: WatcherEvent[] = []
          yield* bus.subscribe(FileSystem.Event.Changed).pipe(
            Stream.runForEach((event) => Effect.sync(() => changes.push(event.data))),
            Effect.forkScoped,
          )
          const setHead = (content: string) =>
            nextUpdate(
              (event) => event.file === head,
              fs.writeFileString(head, content).pipe(Effect.andThen(offer(head))),
            )
          yield* Effect.promise(() => $`git branch feat/packed`.cwd(directory).quiet())
          yield* Effect.promise(() => $`git pack-refs --all`.cwd(directory).quiet())
          yield* LocationWatcher.Service
          yield* until(() => subscriptions.length === 2)
          const initial = path.join(
            gitdir,
            (yield* Effect.promise(() => $`git symbolic-ref HEAD`.cwd(directory).text())).trimEnd(),
          )
          yield* setHead("ref: refs/heads/feat/packed\n")
          yield* until(() => subscriptions.length === 3 && released.length === 1)

          // Back on the first branch, whose packed ref is watched directly.
          yield* setHead(`ref: ${path.relative(gitdir, initial)}\n`)
          yield* until(() => subscriptions.length === 4 && released.length === 2)
          expect(subscriptions[3]).toEqual({ path: initial, type: "file" })

          // The nested ref appears while it is not followed; following it again reports no change of it.
          yield* fs.ensureDir(folder)
          yield* fs.writeFileString(
            ref,
            `${yield* Effect.promise(() => $`git rev-parse HEAD`.cwd(directory).text())}\n`,
          )
          yield* setHead("ref: refs/heads/feat/packed\n")
          yield* until(() => subscriptions.length === 5 && released.length === 3)
          expect(subscriptions[4]).toEqual({ path: ref, type: "file" })
          expect(changes.filter((event) => event.file !== head)).toEqual([])
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("reads the ref again once the watch for its missing folder is acquired", () => {
    const acquiring = Deferred.makeUnsafe<void>()
    const acquire = Deferred.makeUnsafe<void>()
    const watcher = Watcher.layer().pipe(
      Layer.provide(
        Layer.succeed(Watcher.Native, {
          subscribe: (input) =>
            (path.basename(input.target) === "feat"
              ? Deferred.succeed(acquiring, undefined).pipe(Effect.andThen(Deferred.await(acquire)))
              : Effect.void
            ).pipe(Effect.as({ unsubscribe: () => Promise.resolve() })),
        }),
      ),
    )
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const policy = yield* LocationWatcherPolicy.Service
          const fs = yield* FSUtil.Service
          const head = path.join(directory, ".git", "HEAD")
          const ref = path.join(directory, ".git", "refs", "heads", "feat", "packed")
          yield* Effect.promise(() => $`git branch feat/packed`.cwd(directory).quiet())
          yield* Effect.promise(() => $`git pack-refs --all`.cwd(directory).quiet())
          yield* LocationWatcher.Service
          yield* fs.writeFileString(head, "ref: refs/heads/feat/packed\n")
          yield* policy.reload()
          yield* Deferred.await(acquiring).pipe(Effect.timeout("5 seconds"))
          // The commit lands while the watch for the folder is still being acquired, so no watch sees it.
          yield* Effect.promise(() => $`git commit --allow-empty -m packed`.cwd(directory).quiet())
          const seen = yield* wait((event) => event.file === ref)
          yield* Deferred.succeed(acquire, undefined)
          expect(yield* Deferred.await(seen.deferred).pipe(Effect.timeout("5 seconds"))).toEqual({
            file: ref,
            event: "change",
          })
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("acquires a subscription again at the next reconcile once its stream ends", () => {
    const attempts = { ref: 0 }
    const publish = new Map<string, (update: Watcher.Update) => void>()
    const { watcher, acquired } = acquiredWatcher(
      Watcher.layer().pipe(
        Layer.provide(
          Layer.succeed(Watcher.Native, {
            subscribe: (input) =>
              Effect.sync(() => {
                if (path.basename(input.target) === "HEAD") return { unsubscribe: () => Promise.resolve() }
                attempts.ref++
                // Like a missing folder, the first subscription gets no native watch and ends at once.
                if (attempts.ref === 1) return undefined
                publish.set(input.target, input.publish)
                return { unsubscribe: () => Promise.resolve() }
              }),
          }),
        ),
      ),
    )
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const policy = yield* LocationWatcherPolicy.Service
          const ref = path.join(
            directory,
            ".git",
            (yield* Effect.promise(() => $`git symbolic-ref HEAD`.cwd(directory).text())).trimEnd(),
          )
          yield* LocationWatcher.Service
          // The first subscription ends at once and is not kept as active, so a later reconcile acquires it again.
          yield* until(() => acquired.includes(ref), policy.reload())
          expect(attempts.ref).toBe(2)
          expect(
            yield* nextUpdate(
              (event) => event.file === ref,
              Effect.sync(() => publish.get(ref)!({ path: ref, type: "update" })),
            ),
          ).toEqual({ file: ref, event: "change" })
        }),
      { vcs: "git", watcher },
    )
  })

  it.live("reads HEAD again once its watch is acquired", () => {
    const acquiring = Deferred.makeUnsafe<void>()
    const acquire = Deferred.makeUnsafe<void>()
    const switched = Deferred.makeUnsafe<void>()
    const watcher = Watcher.layer().pipe(
      Layer.provide(
        Layer.succeed(Watcher.Native, {
          subscribe: (input) =>
            (path.basename(input.target) === "HEAD"
              ? Deferred.succeed(acquiring, undefined).pipe(Effect.andThen(Deferred.await(acquire)))
              : path.basename(input.target) === "switched"
                ? Deferred.succeed(switched, undefined)
                : Effect.void
            ).pipe(Effect.as({ unsubscribe: () => Promise.resolve() })),
        }),
      ),
    )
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          yield* LocationWatcher.Service
          yield* Deferred.await(acquiring).pipe(Effect.timeout("5 seconds"))
          // No update can arrive for a move that happens while the HEAD watch is still being acquired.
          yield* Effect.promise(() => $`git checkout -b switched`.cwd(directory).quiet())
          yield* Deferred.succeed(acquire, undefined)
          yield* Deferred.await(switched).pipe(Effect.timeout("5 seconds"))
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
              Effect.filterOrFail((count) => count === 2),
              Effect.retry(Schedule.spaced("10 millis")),
            )
            expect(counts.active).toBe(2)

            entries.current = [new Document({ type: "document", info: new Info({ watcher: { ignore: [".git"] } }) })]
            yield* ConfigLocationWatcherPlugin.Plugin.effect(
              host({ event: { subscribe: () => bus.subscribe(Event.Updated) } }),
            )
            yield* Effect.sync(() => counts.active).pipe(
              Effect.filterOrFail((count) => count === 0),
              Effect.retry(Schedule.spaced("10 millis")),
            )
            expect(counts.released).toBe(2)

            entries.current = []
            yield* bus.publish(Event.Updated, {})
            yield* Effect.sync(() => subscriptions.length).pipe(
              Effect.filterOrFail((count) => count === 4),
              Effect.retry(Schedule.spaced("10 millis")),
            )
            expect(counts.active).toBe(2)

            yield* policy.reload()
            expect(subscriptions).toHaveLength(4)
          }),
        { vcs: "git", watcher, config },
      )
      expect(counts.active).toBe(0)
      expect(counts.released).toBe(4)
    })
  })

  it.live("uses the policy changed while target discovery was suspended", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const discovering = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const subscribed = yield* Deferred.make<void>()
      const subscriptions: Watcher.WatchInput[] = []
      let released = 0
      yield* withTmp(
        (directory) =>
          Effect.gen(function* () {
            const policy = yield* LocationWatcherPolicy.Service
            yield* Deferred.await(discovering)
            const update = yield* policy
              .transform((editor) => editor.add([".hg"]))
              .pipe(Effect.forkScoped({ startImmediately: true }))
            expect(policy.current()).toEqual([".hg"])
            yield* Deferred.succeed(release, undefined)
            const registration = yield* Fiber.join(update)
            expect(subscriptions).toEqual([])

            yield* registration.dispose
            yield* Deferred.await(subscribed)
            yield* policy.reload()
            expect(subscriptions).toEqual([{ path: path.join(directory, ".hg", "branch"), type: "file" }])
            expect(released).toBe(0)
          }),
        {
          vcs: "hg",
          replacements: [
            Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            FSUtil.node.replace(
              Layer.succeed(FSUtil.Service, {
                ...fs,
                realPath: (target) =>
                  Deferred.succeed(discovering, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                    Effect.andThen(fs.realPath(target)),
                  ),
              }),
            ),
          ],
          watcher: Layer.succeed(
            Watcher.Service,
            Watcher.Service.of({
              subscribe: (input) =>
                Effect.sync(() => subscriptions.push(input)).pipe(
                  Effect.andThen(Deferred.succeed(subscribed, undefined)),
                  Effect.as(Stream.never.pipe(Stream.ensuring(Effect.sync(() => released++)))),
                ),
            }),
          ),
        },
      )
      expect(released).toBe(1)
    }),
  )

  it.live("does not start before configured policy is ready", () => {
    const subscriptions: Watcher.WatchInput[] = []
    const watcher = Layer.succeed(
      Watcher.Service,
      Watcher.Service.of({
        subscribe: (input) => Effect.sync(() => subscriptions.push(input)).pipe(Effect.as(Stream.never)),
      }),
    )
    const plugins = makeLocationNode({
      name: "test/watcher-plugins",
      layer: Layer.effectDiscard(
        Effect.gen(function* () {
          const policy = yield* LocationWatcherPolicy.Service
          yield* policy.transform((editor) => editor.add([".git"]))
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
      { vcs: "git", watcher, plugins: PluginSupervisor.node.replace(plugins) },
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

// A Watcher that records every subscription and delivers only what the test offers to its queue.
function queuedWatcher() {
  const subscriptions: Watcher.WatchInput[] = []
  const queues = new Map<string, Queue.Queue<Watcher.Update>>()
  const released: string[] = []
  const watcher = Layer.succeed(
    Watcher.Service,
    Watcher.Service.of({
      subscribe: (input) =>
        Effect.gen(function* () {
          subscriptions.push(input)
          const queue = yield* Queue.unbounded<Watcher.Update>()
          queues.set(input.path, queue)
          return Stream.fromQueue(queue).pipe(Stream.ensuring(Effect.sync(() => released.push(input.path))))
        }),
    }),
  )
  const offer = (file: string) => Queue.offer(queues.get(file)!, { path: file, type: "update" })
  return { watcher, subscriptions, released, offer }
}

// Waits for `check`, running `each` before every attempt.
function until(check: () => boolean, each: Effect.Effect<void> = Effect.void) {
  return each.pipe(
    Effect.andThen(Effect.sync(check)),
    Effect.filterOrFail(Boolean),
    Effect.retry(Schedule.spaced("10 millis")),
    Effect.timeout("5 seconds"),
  )
}

// The given Watcher, recording the target of each acquisition once the subscription is live.
function acquiredWatcher(base: Layer.Layer<Watcher.Service>) {
  const acquired: string[] = []
  const watcher = Layer.effect(
    Watcher.Service,
    Effect.gen(function* () {
      const service = yield* Watcher.Service
      return Watcher.Service.of({
        subscribe: (input, onReady) =>
          service.subscribe(
            input,
            Effect.sync(() => acquired.push(input.path)).pipe(Effect.andThen(onReady ?? Effect.void)),
          ),
      })
    }),
  ).pipe(Layer.provide(base))
  return { watcher, acquired }
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

  it.live("publishes the branch ref events a commit rewrites", () =>
    withTmp(
      (directory) =>
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          const head = path.join(directory, ".git", "HEAD")
          const ref = path.join(directory, ".git", (yield* fs.readFileStringSafe(head))!.trim().slice("ref: ".length))
          yield* ready(ref)
          expect(
            yield* nextUpdate(
              (event) => event.file === ref,
              Effect.promise(() => $`git commit --allow-empty -m next`.cwd(directory).quiet()),
            ),
          ).toEqual({ file: ref, event: "change" })
        }),
      { vcs: "git" },
    ),
  )

  it.live("publishes the ref events of a packed nested branch", () => {
    const { watcher, acquired } = acquiredWatcher(AppNodeBuilder.build(Watcher.node))
    return withTmp(
      (directory) =>
        Effect.gen(function* () {
          const head = path.join(directory, ".git", "HEAD")
          const folder = path.join(directory, ".git", "refs", "heads", "feat")
          const ref = path.join(folder, "packed")
          yield* ready(head)
          // `git pack-refs` keeps the packed refs and removes the folder of a nested branch name.
          yield* Effect.promise(() => $`git branch feat/packed`.cwd(directory).quiet())
          yield* Effect.promise(() => $`git pack-refs --all`.cwd(directory).quiet())
          expect(
            yield* nextUpdate(
              (event) => event.file === head,
              Effect.promise(() => $`git checkout feat/packed`.cwd(directory).quiet()),
            ),
          ).toEqual({ file: head, event: "change" })
          yield* until(() => acquired.includes(folder))
          expect(
            yield* nextUpdate(
              (event) => event.file === ref,
              Effect.promise(() => $`git commit --allow-empty -m packed`.cwd(directory).quiet()),
            ),
          ).toEqual({ file: ref, event: "change" })
          yield* until(() => acquired.includes(ref))
          expect(
            yield* nextUpdate(
              (event) => event.file === ref,
              Effect.promise(() => $`git commit --allow-empty -m next`.cwd(directory).quiet()),
            ),
          ).toEqual({ file: ref, event: "change" })
        }),
      { vcs: "git", watcher },
    )
  })

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
    Effect.gen(function* () {
      const started = yield* Deferred.make<string>()
      const watcher = Layer.effect(
        Watcher.Service,
        Effect.gen(function* () {
          const service = yield* Watcher.Service
          return Watcher.Service.of({
            subscribe: (input, onReady) =>
              service.subscribe(
                input,
                Deferred.succeed(started, input.path).pipe(Effect.andThen(onReady ?? Effect.void)),
              ),
          })
        }),
      ).pipe(Layer.provide(AppNodeBuilder.build(Watcher.node)))
      return yield* withTmp(
        (directory) =>
          Effect.gen(function* () {
            const fs = yield* FSUtil.Service
            const branch = path.join(directory, ".hg", "branch")
            // Use the actual acquisition barrier, not a probe write whose event
            // callback can race the next write in Bun's filesystem watcher.
            expect(yield* Deferred.await(started)).toBe(branch)
            expect(
              yield* nextUpdate((event) => event.file === branch, fs.writeFileString(branch, "feature\n")),
            ).toMatchObject({ file: branch })
          }),
        { vcs: "hg", watcher },
      )
    }),
  )
})
