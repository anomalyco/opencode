import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceActivity } from "@opencode-ai/core/instance-activity"
import { PtyActivity } from "@opencode-ai/core/pty/activity"
import { Deferred, Effect, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { mkdir, rename, symlink, unlink } from "fs/promises"
import { join } from "path"
import { InstanceRef } from "../../src/effect/instance-ref"
import { registerDisposer } from "../../src/effect/instance-registry"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

let bootstrapRun: Effect.Effect<void> = Effect.void
const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.suspend(() => bootstrapRun) }),
)

const it = testEffect(
  LayerNode.compile(LayerNode.group([InstanceStore.node, CrossSpawnSpawner.node]), [
    [InstanceStore.bootstrapNode, noopBootstrap],
  ]),
)

const setBootstrap = (run: Effect.Effect<void>) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      bootstrapRun = run
    }),
    () =>
      Effect.sync(() => {
        bootstrapRun = Effect.void
      }),
  )

const registerDisposerScoped = (disposer: (directory: string) => Promise<void>) =>
  Effect.acquireRelease(
    Effect.sync(() => registerDisposer(disposer)),
    (off) => Effect.sync(off),
  )

describe("InstanceStore", () => {
  it.live("loads instance context", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* store.load({ directory: dir })

      expect(ctx.directory).toBe(dir)
      expect(ctx.worktree).toBe(dir)
    }),
  )

  it.live("runs bootstrap with InstanceRef provided", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initializedDirectory: string | undefined

      yield* setBootstrap(
        Effect.gen(function* () {
          initializedDirectory = (yield* InstanceRef)?.directory
        }),
      )
      yield* store.load({ directory: dir })

      expect(initializedDirectory).toBe(dir)
    }),
  )

  it.live("caches loaded instance context by directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initialized = 0

      yield* setBootstrap(
        Effect.sync(() => {
          initialized++
        }),
      )
      const first = yield* store.load({ directory: dir })
      const second = yield* store.load({ directory: dir })

      expect(second).toBe(first)
      expect(initialized).toBe(1)
    }),
  )

  it.live("dedupes concurrent loads while init is in flight", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let initialized = 0

      yield* setBootstrap(
        Effect.gen(function* () {
          initialized++
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }),
      )
      const first = yield* store.load({ directory: dir }).pipe(Effect.forkScoped)

      yield* Deferred.await(started)

      yield* setBootstrap(
        Effect.sync(() => {
          initialized++
        }),
      )
      const second = yield* store.load({ directory: dir }).pipe(Effect.forkScoped)

      expect(initialized).toBe(1)
      yield* Deferred.succeed(release, undefined)

      const [firstCtx, secondCtx] = yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(secondCtx).toBe(firstCtx)
      expect(initialized).toBe(1)
    }),
  )

  it.live("removes failed loads from the cache", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let attempts = 0

      yield* setBootstrap(
        Effect.sync(() => {
          attempts++
          throw new Error("init failed")
        }),
      )
      const failed = yield* store.load({ directory: dir }).pipe(
        Effect.as(false),
        Effect.catchCause(() => Effect.succeed(true)),
      )

      expect(failed).toBe(true)

      yield* setBootstrap(
        Effect.sync(() => {
          attempts++
        }),
      )
      const ctx = yield* store.load({ directory: dir })

      expect(ctx.directory).toBe(dir)
      expect(attempts).toBe(2)
    }),
  )

  it.live("reload replaces the cached context", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      const first = yield* store.load({ directory: dir })
      const second = yield* store.reload({ directory: dir })
      const cached = yield* store.load({ directory: dir })

      expect(second).not.toBe(first)
      expect(cached).toBe(second)
    }),
  )

  it.live("serializes concurrent reloads", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposing = yield* Deferred.make<void>()
      const releaseDispose = yield* Deferred.make<() => void>()
      let disposed = 0
      yield* registerDisposerScoped(() => {
        disposed++
        if (disposed !== 1) return Promise.resolve()
        Deferred.doneUnsafe(disposing, Effect.void)
        return new Promise<void>((resolve) => Deferred.doneUnsafe(releaseDispose, Effect.succeed(resolve)))
      })

      const first = yield* store.load({ directory: dir })
      const reloadA = yield* store.reload({ directory: dir }).pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)
      const reloadB = yield* store.reload({ directory: dir }).pipe(Effect.forkScoped)

      const finishDispose = yield* Deferred.await(releaseDispose)
      yield* Effect.sync(finishDispose)
      const [second, third] = yield* Effect.all([Fiber.join(reloadA), Fiber.join(reloadB)])

      expect(second).not.toBe(first)
      expect(third).not.toBe(second)
      expect(yield* store.load({ directory: dir })).toBe(third)
      expect(disposed).toBe(2)
    }),
  )

  it.effect("keeps an active lease and touches its last-used time on release", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const acquired = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const disposed: Array<string> = []
      yield* registerDisposerScoped(async (directory) => {
        disposed.push(directory)
      })

      yield* TestClock.setTime(0)
      yield* store.load({ directory: dir })
      yield* TestClock.setTime(100)
      const lease = yield* store
        .provide(
          { directory: dir },
          Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(acquired)

      yield* TestClock.setTime(200)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 0, canDispose: () => Effect.succeed(true) })).toBe(0)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(lease)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(0)

      yield* TestClock.setTime(251)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(1)
      expect(disposed).toEqual([dir])
    }),
  )

  it.live("waits for unrelated leases before reload", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const leased = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let disposed = 0
      yield* registerDisposerScoped(async () => {
        disposed++
      })

      const first = yield* store.load({ directory: dir })
      const lease = yield* store
        .provide({ directory: dir }, Deferred.succeed(leased, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(leased)
      const reload = yield* store.reload({ directory: dir }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      expect(disposed).toBe(0)
      expect(yield* store.load({ directory: dir })).toBe(first)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(lease)
      const second = yield* Fiber.join(reload)
      expect(second).not.toBe(first)
      expect(disposed).toBe(1)
    }),
  )

  it.live("waits for unrelated leases before dispose", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const leased = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let disposed = 0
      yield* registerDisposerScoped(async () => {
        disposed++
      })

      const first = yield* store.load({ directory: dir })
      const lease = yield* store
        .provide({ directory: dir }, Deferred.succeed(leased, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(leased)
      const dispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      expect(disposed).toBe(0)
      expect(yield* store.load({ directory: dir })).toBe(first)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(lease)
      yield* Fiber.join(dispose)
      expect(disposed).toBe(1)
      expect(yield* store.load({ directory: dir })).not.toBe(first)
    }),
  )

  it.effect("starts a new idle epoch after blocking activity completes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let active = true
      let disposed = 0
      yield* registerDisposerScoped(async () => {
        disposed++
      })

      yield* TestClock.setTime(0)
      yield* store.load({ directory: dir })
      yield* TestClock.setTime(100)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(!active) })).toBe(0)

      // The activity outlives the original idle timeout. Its first observed idle
      // sweep starts a fresh epoch instead of immediately disposing the instance.
      yield* TestClock.setTime(10_000)
      active = false
      InstanceActivity.touch(InstanceActivity.identify(dir))
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(!active) })).toBe(0)
      yield* TestClock.setTime(10_049)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(!active) })).toBe(0)
      yield* TestClock.setTime(10_050)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(!active) })).toBe(1)
      expect(disposed).toBe(1)
    }),
  )

  it.effect("retains activity entirely between sweeps for a full timeout", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      yield* TestClock.setTime(0)
      yield* store.load({ directory: dir })
      yield* TestClock.setTime(100)
      const activity = InstanceActivity.identify(dir)
      InstanceActivity.touch(activity)
      InstanceActivity.touch(activity)

      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(0)
      yield* TestClock.setTime(149)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(0)
      yield* TestClock.setTime(150)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(1)
    }),
  )

  it.effect("atomically rejects eviction when a PTY starts while policy checks are paused", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const checking = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()

      yield* TestClock.setTime(0)
      const first = yield* store.load({ directory: dir })
      const activity = PtyActivity.identify(first.directory)
      yield* TestClock.setTime(100)
      const sweep = yield* store
        .sweepIdle({
          idleTimeoutMs: 50,
          canDispose: () =>
            Deferred.succeed(checking, undefined).pipe(Effect.andThen(Deferred.await(resume)), Effect.as(true)),
        })
        .pipe(Effect.forkScoped)

      yield* Deferred.await(checking)
      PtyActivity.started(activity)
      yield* Deferred.succeed(resume, undefined)
      expect(yield* Fiber.join(sweep)).toBe(0)
      expect(yield* store.load({ directory: dir })).toBe(first)
      PtyActivity.stopped(activity)
    }),
  )

  it.effect("keeps entry activity stable when its pathname is replaced", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const owner = join(root, "owner")
      const moved = join(root, "moved")
      const replacement = join(root, "replacement")
      yield* Effect.promise(() => Promise.all([mkdir(owner), mkdir(replacement)]))
      const store = yield* InstanceStore.Service

      yield* TestClock.setTime(0)
      const ctx = yield* store.load({ directory: owner })
      const activity = PtyActivity.identify(ctx.directory)
      PtyActivity.started(activity)

      yield* Effect.promise(async () => {
        await rename(owner, moved)
        await symlink(replacement, owner, "dir")
      })
      yield* TestClock.setTime(100)
      expect(PtyActivity.hasRunning(owner)).toBe(true)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(0)
      expect(yield* store.load({ directory: owner })).toBe(ctx)

      PtyActivity.stopped(activity)
      expect(PtyActivity.hasRunning(owner)).toBe(false)
      expect(InstanceActivity.snapshot(activity).runningPtys).toBe(0)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(0)
      yield* TestClock.setTime(151)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(0)
      yield* TestClock.setTime(202)
      expect(yield* store.sweepIdle({ idleTimeoutMs: 50, canDispose: () => Effect.succeed(true) })).toBe(1)
    }),
  )

  it.effect("keeps a remembered symlink alias stable for the entry lifetime", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const target = join(root, "target")
      const replacement = join(root, "replacement")
      const alias = join(root, "alias")
      yield* Effect.promise(async () => {
        await Promise.all([mkdir(target), mkdir(replacement)])
        await symlink(target, alias, "dir")
      })
      const store = yield* InstanceStore.Service

      const ctx = yield* store.load({ directory: alias })
      const activity = PtyActivity.identify(ctx.directory)
      PtyActivity.started(activity)
      yield* Effect.promise(async () => {
        await unlink(alias)
        await symlink(replacement, alias, "dir")
      })

      expect(yield* store.load({ directory: alias })).toBe(ctx)
      expect(PtyActivity.hasRunning(ctx.directory)).toBe(true)
      PtyActivity.stopped(activity)
      expect(InstanceActivity.snapshot(activity).runningPtys).toBe(0)

      yield* store.dispose(ctx)
      const next = yield* store.load({ directory: alias })
      expect(next).not.toBe(ctx)
      expect(next.directory).toBe(replacement)
    }),
  )

  it.live("keeps waiting alias loads on the frozen key across tombstone cleanup", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const canonical = join(root, "canonical")
      const replacement = join(root, "replacement")
      const alias = join(root, "alias")
      yield* Effect.promise(async () => {
        await Promise.all([mkdir(canonical), mkdir(replacement)])
        await symlink(canonical, alias, "dir")
      })
      const store = yield* InstanceStore.Service
      const disposing = yield* Deferred.make<void>()
      const releaseDispose = yield* Deferred.make<() => void>()
      let disposed = 0
      yield* registerDisposerScoped(() => {
        disposed++
        if (disposed !== 1) return Promise.resolve()
        Deferred.doneUnsafe(disposing, Effect.void)
        return new Promise<void>((resolve) => Deferred.doneUnsafe(releaseDispose, Effect.succeed(resolve)))
      })

      const first = yield* store.load({ directory: alias })
      const dispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)

      const waitingA = yield* store.load({ directory: alias }).pipe(Effect.forkScoped)
      const waitingB = yield* store.load({ directory: alias }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Effect.promise(async () => {
        await unlink(alias)
        await symlink(replacement, alias, "dir")
      })

      const finishDispose = yield* Deferred.await(releaseDispose)
      yield* Effect.sync(finishDispose)
      yield* Fiber.join(dispose)
      const [secondA, secondB] = yield* Effect.all([Fiber.join(waitingA), Fiber.join(waitingB)])
      const subsequent = yield* store.load({ directory: alias })

      expect(secondA).not.toBe(first)
      expect(secondB).toBe(secondA)
      expect(subsequent).toBe(secondA)
      expect(secondA.directory).toBe(canonical)

      yield* store.dispose(secondA)
      const afterCleanup = yield* store.load({ directory: alias })
      expect(afterCleanup).not.toBe(secondA)
      expect(afterCleanup.directory).toBe(replacement)
      expect(disposed).toBe(2)
    }),
  )

  it.live("releases an interrupted alias reservation", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped({ git: true })
      const canonical = join(root, "canonical")
      const replacement = join(root, "replacement")
      const alias = join(root, "alias")
      yield* Effect.promise(async () => {
        await Promise.all([mkdir(canonical), mkdir(replacement)])
        await symlink(canonical, alias, "dir")
      })
      const store = yield* InstanceStore.Service
      const disposing = yield* Deferred.make<void>()
      const releaseDispose = yield* Deferred.make<() => void>()
      let disposed = 0
      yield* registerDisposerScoped(() => {
        disposed++
        if (disposed !== 1) return Promise.resolve()
        Deferred.doneUnsafe(disposing, Effect.void)
        return new Promise<void>((resolve) => Deferred.doneUnsafe(releaseDispose, Effect.succeed(resolve)))
      })

      const first = yield* store.load({ directory: alias })
      const dispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)
      const waiting = yield* store.load({ directory: alias }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Effect.promise(async () => {
        await unlink(alias)
        await symlink(replacement, alias, "dir")
      })
      yield* Fiber.interrupt(waiting)

      const finishDispose = yield* Deferred.await(releaseDispose)
      yield* Effect.sync(finishDispose)
      yield* Fiber.join(dispose)
      const next = yield* store.load({ directory: alias })
      expect(next.directory).toBe(replacement)
      expect(disposed).toBe(1)
    }),
  )

  it.effect("releases a lease when its effect is interrupted", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const acquired = yield* Deferred.make<void>()
      const disposed: Array<string> = []
      yield* registerDisposerScoped(async (directory) => {
        disposed.push(directory)
      })

      const lease = yield* store
        .provide({ directory: dir }, Deferred.succeed(acquired, undefined).pipe(Effect.andThen(Effect.never)))
        .pipe(Effect.forkScoped)
      yield* Deferred.await(acquired)
      yield* Fiber.interrupt(lease)

      expect(yield* store.sweepIdle({ idleTimeoutMs: 0, canDispose: () => Effect.succeed(true) })).toBe(1)
      expect(disposed).toEqual([dir])
    }),
  )

  it.effect("retains a candidate touched while its activity check is in flight", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const checking = yield* Deferred.make<void>()
      const releaseCheck = yield* Deferred.make<void>()
      let disposed = 0
      yield* registerDisposerScoped(async () => {
        disposed++
      })

      yield* TestClock.setTime(0)
      const first = yield* store.load({ directory: dir })
      yield* TestClock.setTime(100)
      const sweep = yield* store
        .sweepIdle({
          idleTimeoutMs: 50,
          canDispose: () =>
            Deferred.succeed(checking, undefined).pipe(Effect.andThen(Deferred.await(releaseCheck)), Effect.as(true)),
        })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(checking)

      expect(yield* store.load({ directory: dir })).toBe(first)
      yield* Deferred.succeed(releaseCheck, undefined)
      expect(yield* Fiber.join(sweep)).toBe(0)
      expect(disposed).toBe(0)
    }),
  )

  it.effect("retains a candidate leased while its activity check is in flight", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const checking = yield* Deferred.make<void>()
      const releaseCheck = yield* Deferred.make<void>()
      const leased = yield* Deferred.make<void>()
      const releaseLease = yield* Deferred.make<void>()
      let disposed = 0
      yield* registerDisposerScoped(async () => {
        disposed++
      })

      yield* TestClock.setTime(0)
      yield* store.load({ directory: dir })
      yield* TestClock.setTime(100)
      const sweep = yield* store
        .sweepIdle({
          idleTimeoutMs: 50,
          canDispose: () =>
            Deferred.succeed(checking, undefined).pipe(Effect.andThen(Deferred.await(releaseCheck)), Effect.as(true)),
        })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(checking)
      const lease = yield* store
        .provide(
          { directory: dir },
          Deferred.succeed(leased, undefined).pipe(Effect.andThen(Deferred.await(releaseLease))),
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(leased)

      yield* Deferred.succeed(releaseCheck, undefined)
      expect(yield* Fiber.join(sweep)).toBe(0)
      expect(disposed).toBe(0)
      yield* Deferred.succeed(releaseLease, undefined)
      yield* Fiber.join(lease)
    }),
  )

  it.live("waits for disposal before loading a fresh context", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposing = yield* Deferred.make<void>()
      const releaseDispose = yield* Deferred.make<() => void>()
      let loaded = false
      yield* registerDisposerScoped(() => {
        Deferred.doneUnsafe(disposing, Effect.void)
        return new Promise<void>((resolve) => Deferred.doneUnsafe(releaseDispose, Effect.succeed(resolve)))
      })

      const first = yield* store.load({ directory: dir })
      const dispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)
      const load = yield* store.load({ directory: dir }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            loaded = true
          }),
        ),
        Effect.forkScoped,
      )
      yield* Effect.yieldNow
      expect(loaded).toBe(false)

      const finishDispose = yield* Deferred.await(releaseDispose)
      yield* Effect.sync(finishDispose)
      yield* Fiber.join(dispose)
      const second = yield* Fiber.join(load)
      expect(second).not.toBe(first)
      expect(yield* store.load({ directory: dir })).toBe(second)
    }),
  )

  it.live("dedupes concurrent idle sweeps", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposing = yield* Deferred.make<void>()
      const releaseDispose = yield* Deferred.make<() => void>()
      let disposed = 0
      yield* registerDisposerScoped(() => {
        disposed++
        Deferred.doneUnsafe(disposing, Effect.void)
        return new Promise<void>((resolve) => Deferred.doneUnsafe(releaseDispose, Effect.succeed(resolve)))
      })

      yield* store.load({ directory: dir })
      const first = yield* store
        .sweepIdle({ idleTimeoutMs: 0, canDispose: () => Effect.succeed(true) })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)
      const second = yield* store
        .sweepIdle({ idleTimeoutMs: 0, canDispose: () => Effect.succeed(true) })
        .pipe(Effect.forkScoped)

      const finishDispose = yield* Deferred.await(releaseDispose)
      yield* Effect.sync(finishDispose)
      expect(yield* Fiber.join(first)).toBe(1)
      expect(yield* Fiber.join(second)).toBe(0)
      expect(disposed).toBe(1)
    }),
  )

  it.live("stale dispose does not delete an in-flight reload", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const reloading = yield* Deferred.make<void>()
      const releaseReload = yield* Deferred.make<void>()
      const disposed: Array<string> = []
      yield* registerDisposerScoped(async (directory) => {
        disposed.push(directory)
      })

      const first = yield* store.load({ directory: dir })
      yield* setBootstrap(
        Effect.gen(function* () {
          yield* Deferred.succeed(reloading, undefined)
          yield* Deferred.await(releaseReload)
        }),
      )
      const reload = yield* store.reload({ directory: dir }).pipe(Effect.forkScoped)

      yield* Deferred.await(reloading)
      const staleDispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      yield* Deferred.succeed(releaseReload, undefined)

      const second = yield* Fiber.join(reload)
      yield* Fiber.join(staleDispose)

      expect(disposed).toEqual([dir])
      expect(yield* store.load({ directory: dir })).toBe(second)
    }),
  )

  it.live("dedupes concurrent disposeAll calls", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposing = yield* Deferred.make<void>()
      const releaseDispose = yield* Deferred.make<() => void>()
      const disposed: Array<string> = []
      yield* registerDisposerScoped((directory) => {
        disposed.push(directory)
        Deferred.doneUnsafe(disposing, Effect.void)
        return new Promise<void>((resolve) => {
          Deferred.doneUnsafe(releaseDispose, Effect.succeed(resolve))
        })
      })

      yield* store.load({ directory: dir })
      const first = yield* store.disposeAll().pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)
      const release = yield* Deferred.await(releaseDispose)
      const second = yield* store.disposeAll().pipe(Effect.forkScoped)

      expect(disposed).toEqual([dir])
      yield* Effect.sync(release)
      yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(disposed).toEqual([dir])
    }),
  )

  it.live("releases every self-lease before sharing concurrent disposeAll", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const readyA = yield* Deferred.make<void>()
      const readyB = yield* Deferred.make<void>()
      const go = yield* Deferred.make<void>()
      let disposed = 0
      yield* registerDisposerScoped(async () => {
        disposed++
      })
      yield* store.load({ directory: dir })

      const caller = (ready: Deferred.Deferred<void>) =>
        store.provide(
          { directory: dir },
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(go)),
            Effect.andThen(store.disposeAll()),
          ),
        )
      const first = yield* caller(readyA).pipe(Effect.forkScoped)
      const second = yield* caller(readyB).pipe(Effect.forkScoped)

      yield* Deferred.await(readyA)
      yield* Deferred.await(readyB)
      yield* Deferred.succeed(go, undefined)
      yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(disposed).toBe(1)
    }),
  )

  it.live("re-arms disposeAll after completion", () =>
    Effect.gen(function* () {
      const dir1 = yield* tmpdirScoped({ git: true })
      const dir2 = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposed: Array<string> = []
      yield* registerDisposerScoped(async (directory) => {
        disposed.push(directory)
      })

      yield* store.load({ directory: dir1 })
      yield* store.disposeAll()
      expect(disposed).toEqual([dir1])

      yield* store.load({ directory: dir2 })
      yield* store.disposeAll()
      expect(disposed).toEqual([dir1, dir2])
    }),
  )
})
