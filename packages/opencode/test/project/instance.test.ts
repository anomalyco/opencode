import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { registerDisposer } from "../../src/effect/instance-registry"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { Instance } from "../../src/project/instance"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

let bootstrapRun: Effect.Effect<void> = Effect.void
const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.suspend(() => bootstrapRun) }),
)

const it = testEffect(
  Layer.mergeAll(InstanceStore.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(noopBootstrap)),
)

afterEach(async () => {
  bootstrapRun = Effect.void
  await disposeAllInstances()
})

describe("InstanceStore", () => {
  it.live("loads instance context without installing ALS for the caller", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* store.load({ directory: dir })

      expect(ctx.directory).toBe(dir)
      expect(ctx.worktree).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )

  it.live("runs bootstrap with InstanceRef provided", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initializedDirectory: string | undefined

      bootstrapRun = Effect.gen(function* () {
        initializedDirectory = (yield* InstanceRef)?.directory
      })
      yield* store.load({ directory: dir })

      expect(initializedDirectory).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )

  it.live("caches loaded instance context by directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initialized = 0

      bootstrapRun = Effect.sync(() => {
        initialized++
      })
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

      bootstrapRun = Effect.gen(function* () {
        initialized++
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
      })
      const first = yield* store.load({ directory: dir }).pipe(Effect.forkScoped)

      yield* Deferred.await(started)

      bootstrapRun = Effect.sync(() => {
        initialized++
      })
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

      bootstrapRun = Effect.sync(() => {
        attempts++
        throw new Error("init failed")
      })
      const failed = yield* store.load({ directory: dir }).pipe(
        Effect.as(false),
        Effect.catchCause(() => Effect.succeed(true)),
      )

      expect(failed).toBe(true)

      bootstrapRun = Effect.sync(() => {
        attempts++
      })
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

  it.live("stale dispose does not delete an in-flight reload", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const reloading = yield* Deferred.make<void>()
      const releaseReload = yield* Deferred.make<void>()
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const first = yield* store.load({ directory: dir })
      bootstrapRun = Effect.gen(function* () {
        yield* Deferred.succeed(reloading, undefined)
        yield* Deferred.await(releaseReload)
      })
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
      const releaseDispose = yield* Deferred.make<void>()
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
        Deferred.doneUnsafe(disposing, Effect.void)
        await Effect.runPromise(Deferred.await(releaseDispose))
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      yield* store.load({ directory: dir })
      const first = yield* store.disposeAll().pipe(Effect.forkScoped)
      yield* Deferred.await(disposing)
      const second = yield* store.disposeAll().pipe(Effect.forkScoped)

      expect(disposed).toEqual([dir])
      yield* Deferred.succeed(releaseDispose, undefined)
      yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(disposed).toEqual([dir])
    }),
  )

  it.live("re-arms disposeAll after completion", () =>
    Effect.gen(function* () {
      const dir1 = yield* tmpdirScoped({ git: true })
      const dir2 = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      yield* store.load({ directory: dir1 })
      yield* store.disposeAll()
      expect(disposed).toEqual([dir1])

      yield* store.load({ directory: dir2 })
      yield* store.disposeAll()
      expect(disposed).toEqual([dir1, dir2])
    }),
  )

  it.instance("provides legacy Promise callers with instance ALS", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const ctx = yield* InstanceRef
      if (!ctx) throw new Error("InstanceRef not provided")

      const directory = yield* Effect.promise(() => Promise.resolve(Instance.restore(ctx, () => Instance.directory)))

      expect(directory).toBe(test.directory)
      expect(() => Instance.current).toThrow()
    }),
    { git: true },
  )
})
