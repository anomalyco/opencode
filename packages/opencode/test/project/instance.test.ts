import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Fiber, Layer } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { registerDisposer } from "../../src/effect/instance-registry"
import { Instance } from "../../src/project/instance"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(InstanceStore.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await Instance.disposeAll()
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

  it.live("runs load init with InstanceRef provided", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initializedDirectory: string | undefined

      yield* store.load({
        directory: dir,
        init: Effect.gen(function* () {
          initializedDirectory = (yield* InstanceRef)?.directory
        }),
      })

      expect(initializedDirectory).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )

  it.live("caches loaded instance context by directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initialized = 0

      const first = yield* store.load({
        directory: dir,
        init: Effect.sync(() => {
          initialized++
        }),
      })
      const second = yield* store.load({
        directory: dir,
        init: Effect.sync(() => {
          initialized++
        }),
      })

      expect(second).toBe(first)
      expect(initialized).toBe(1)
    }),
  )

  it.live("dedupes concurrent loads while init is in flight", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let initialized = 0

      const first = yield* store
        .load({
          directory: dir,
          init: Effect.promise(async () => {
            initialized++
            started.resolve()
            await release.promise
          }),
        })
        .pipe(Effect.forkScoped)

      yield* Effect.promise(() => started.promise)

      const second = yield* store
        .load({
          directory: dir,
          init: Effect.sync(() => {
            initialized++
          }),
        })
        .pipe(Effect.forkScoped)

      expect(initialized).toBe(1)
      release.resolve()

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

      const failed = yield* store
        .load({
          directory: dir,
          init: Effect.sync(() => {
            attempts++
            throw new Error("init failed")
          }),
        })
        .pipe(
          Effect.as(false),
          Effect.catchCause(() => Effect.succeed(true)),
        )

      expect(failed).toBe(true)

      const ctx = yield* store.load({
        directory: dir,
        init: Effect.sync(() => {
          attempts++
        }),
      })

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
      const reloading = Promise.withResolvers<void>()
      const releaseReload = Promise.withResolvers<void>()
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const first = yield* store.load({ directory: dir })
      const reload = yield* store
        .reload({
          directory: dir,
          init: Effect.promise(async () => {
            reloading.resolve()
            await releaseReload.promise
          }),
        })
        .pipe(Effect.forkScoped)

      yield* Effect.promise(() => reloading.promise)
      const staleDispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      releaseReload.resolve()

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
      const disposing = Promise.withResolvers<void>()
      const releaseDispose = Promise.withResolvers<void>()
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
        disposing.resolve()
        await releaseDispose.promise
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      yield* store.load({ directory: dir })
      const first = yield* store.disposeAll().pipe(Effect.forkScoped)
      yield* Effect.promise(() => disposing.promise)
      const second = yield* store.disposeAll().pipe(Effect.forkScoped)

      expect(disposed).toEqual([dir])
      releaseDispose.resolve()
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

  it.live("keeps Instance.provide as the legacy ALS wrapper", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const directory = yield* Effect.promise(() =>
        Instance.provide({
          directory: dir,
          fn: () => Instance.directory,
        }),
      )

      expect(directory).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )

  it.live("does not install legacy ALS around Effect init", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()

      const directory = yield* Effect.promise(() =>
        Instance.provide({
          directory: dir,
          init: Effect.sync(() => {
            expect(() => Instance.current).toThrow()
          }),
          fn: () => Instance.directory,
        }),
      )

      expect(directory).toBe(dir)
    }),
  )
})
