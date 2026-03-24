import { afterEach, expect, test } from "bun:test"
import { Duration, Effect, Layer, ManagedRuntime, ServiceMap } from "effect"
import { InstanceState } from "../../src/effect/instance-state"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function access<A, E>(state: InstanceState<A, E>, dir: string) {
  return Instance.provide({
    directory: dir,
    fn: () => Effect.runPromise(InstanceState.get(state)),
  })
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("InstanceState caches values per directory", async () => {
  await using tmp = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make(() => Effect.sync(() => ({ n: ++n })))

        const a = yield* Effect.promise(() => access(state, tmp.path))
        const b = yield* Effect.promise(() => access(state, tmp.path))

        expect(a).toBe(b)
        expect(n).toBe(1)
      }),
    ),
  )
})

test("InstanceState isolates directories", async () => {
  await using one = await tmpdir()
  await using two = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make((dir) => Effect.sync(() => ({ dir, n: ++n })))

        const a = yield* Effect.promise(() => access(state, one.path))
        const b = yield* Effect.promise(() => access(state, two.path))
        const c = yield* Effect.promise(() => access(state, one.path))

        expect(a).toBe(c)
        expect(a).not.toBe(b)
        expect(n).toBe(2)
      }),
    ),
  )
})

test("InstanceState invalidates on reload", async () => {
  await using tmp = await tmpdir()
  const seen: string[] = []
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make(() =>
          Effect.acquireRelease(
            Effect.sync(() => ({ n: ++n })),
            (value) =>
              Effect.sync(() => {
                seen.push(String(value.n))
              }),
          ),
        )

        const a = yield* Effect.promise(() => access(state, tmp.path))
        yield* Effect.promise(() => Instance.reload({ directory: tmp.path }))
        const b = yield* Effect.promise(() => access(state, tmp.path))

        expect(a).not.toBe(b)
        expect(seen).toEqual(["1"])
      }),
    ),
  )
})

test("InstanceState invalidates on disposeAll", async () => {
  await using one = await tmpdir()
  await using two = await tmpdir()
  const seen: string[] = []

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) =>
          Effect.acquireRelease(
            Effect.sync(() => ({ dir: ctx.directory })),
            (value) =>
              Effect.sync(() => {
                seen.push(value.dir)
              }),
          ),
        )

        yield* Effect.promise(() => access(state, one.path))
        yield* Effect.promise(() => access(state, two.path))
        yield* Effect.promise(() => Instance.disposeAll())

        expect(seen.sort()).toEqual([one.path, two.path].sort())
      }),
    ),
  )
})

test("InstanceState.get reads the current directory lazily", async () => {
  await using one = await tmpdir()
  await using two = await tmpdir()

  interface Api {
    readonly get: () => Effect.Effect<string>
  }

  class Test extends ServiceMap.Service<Test, Api>()("@test/InstanceStateLazy") {
    static readonly layer = Layer.effect(
      Test,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))
        const get = InstanceState.get(state)

        return Test.of({
          get: Effect.fn("Test.get")(function* () {
            return yield* get
          }),
        })
      }),
    )
  }

  const rt = ManagedRuntime.make(Test.layer)

  try {
    const a = await Instance.provide({
      directory: one.path,
      fn: () => rt.runPromise(Test.use((svc) => svc.get())),
    })
    const b = await Instance.provide({
      directory: two.path,
      fn: () => rt.runPromise(Test.use((svc) => svc.get())),
    })

    expect(a).toBe(one.path)
    expect(b).toBe(two.path)
  } finally {
    await rt.dispose()
  }
})

test("InstanceState preserves directory across async boundaries", async () => {
  await using one = await tmpdir({ git: true })
  await using two = await tmpdir({ git: true })
  await using three = await tmpdir({ git: true })

  interface Api {
    readonly get: () => Effect.Effect<{ directory: string; worktree: string; project: string }>
  }

  class Test extends ServiceMap.Service<Test, Api>()("@test/InstanceStateAsync") {
    static readonly layer = Layer.effect(
      Test,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) =>
          Effect.sync(() => ({
            directory: ctx.directory,
            worktree: ctx.worktree,
            project: ctx.project.id,
          })),
        )

        return Test.of({
          get: Effect.fn("Test.get")(function* () {
            yield* Effect.promise(() => Bun.sleep(1))
            yield* Effect.sleep(Duration.millis(1))
            for (let i = 0; i < 100; i++) {
              yield* Effect.yieldNow
            }
            for (let i = 0; i < 100; i++) {
              yield* Effect.promise(() => Promise.resolve())
            }
            yield* Effect.sleep(Duration.millis(2))
            yield* Effect.promise(() => Bun.sleep(1))
            return yield* InstanceState.get(state)
          }),
        })
      }),
    )
  }

  const rt = ManagedRuntime.make(Test.layer)

  try {
    const [a, b, c] = await Promise.all([
      Instance.provide({
        directory: one.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
      Instance.provide({
        directory: two.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
      Instance.provide({
        directory: three.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
    ])

    expect(a).toEqual({ directory: one.path, worktree: one.path, project: a.project })
    expect(b).toEqual({ directory: two.path, worktree: two.path, project: b.project })
    expect(c).toEqual({ directory: three.path, worktree: three.path, project: c.project })
    expect(a.project).not.toBe(b.project)
    expect(a.project).not.toBe(c.project)
    expect(b.project).not.toBe(c.project)
  } finally {
    await rt.dispose()
  }
})

test("InstanceState survives high-contention concurrent access", async () => {
  const N = 20
  const dirs = await Promise.all(Array.from({ length: N }, () => tmpdir()))

  interface Api {
    readonly get: () => Effect.Effect<string>
  }

  class Test extends ServiceMap.Service<Test, Api>()("@test/HighContention") {
    static readonly layer = Layer.effect(
      Test,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))

        return Test.of({
          get: Effect.fn("Test.get")(function* () {
            // Interleave many async hops to maximize chance of ALS corruption
            for (let i = 0; i < 10; i++) {
              yield* Effect.promise(() => Bun.sleep(Math.random() * 3))
              yield* Effect.yieldNow
              yield* Effect.promise(() => Promise.resolve())
            }
            return yield* InstanceState.get(state)
          }),
        })
      }),
    )
  }

  const rt = ManagedRuntime.make(Test.layer)

  try {
    const results = await Promise.all(
      dirs.map((d) =>
        Instance.provide({
          directory: d.path,
          fn: () => rt.runPromise(Test.use((svc) => svc.get())),
        }),
      ),
    )

    for (let i = 0; i < N; i++) {
      expect(results[i]).toBe(dirs[i].path)
    }
  } finally {
    await rt.dispose()
    for (const d of dirs) await d[Symbol.asyncDispose]()
  }
})

test("InstanceState correct after interleaved init and dispose", async () => {
  await using one = await tmpdir()
  await using two = await tmpdir()

  interface Api {
    readonly get: () => Effect.Effect<string>
  }

  class Test extends ServiceMap.Service<Test, Api>()("@test/InterleavedDispose") {
    static readonly layer = Layer.effect(
      Test,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) =>
          Effect.promise(async () => {
            await Bun.sleep(5) // slow init
            return ctx.directory
          }),
        )

        return Test.of({
          get: Effect.fn("Test.get")(function* () {
            return yield* InstanceState.get(state)
          }),
        })
      }),
    )
  }

  const rt = ManagedRuntime.make(Test.layer)

  try {
    // Init both directories
    const a = await Instance.provide({
      directory: one.path,
      fn: () => rt.runPromise(Test.use((svc) => svc.get())),
    })
    expect(a).toBe(one.path)

    // Dispose one directory, access the other concurrently
    const [, b] = await Promise.all([
      Instance.reload({ directory: one.path }),
      Instance.provide({
        directory: two.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
    ])
    expect(b).toBe(two.path)

    // Re-access disposed directory - should get fresh state
    const c = await Instance.provide({
      directory: one.path,
      fn: () => rt.runPromise(Test.use((svc) => svc.get())),
    })
    expect(c).toBe(one.path)
  } finally {
    await rt.dispose()
  }
})

test("InstanceState mutation in one directory does not leak to another", async () => {
  await using one = await tmpdir()
  await using two = await tmpdir()

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make(() => Effect.sync(() => ({ count: 0 })))

        // Mutate state in directory one
        const s1 = yield* Effect.promise(() => access(state, one.path))
        s1.count = 42

        // Access directory two — should be independent
        const s2 = yield* Effect.promise(() => access(state, two.path))
        expect(s2.count).toBe(0)

        // Confirm directory one still has the mutation
        const s1again = yield* Effect.promise(() => access(state, one.path))
        expect(s1again.count).toBe(42)
        expect(s1again).toBe(s1) // same reference
      }),
    ),
  )
})

test("InstanceState dedupes concurrent lookups", async () => {
  await using tmp = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make(() =>
          Effect.promise(async () => {
            n += 1
            await Bun.sleep(10)
            return { n }
          }),
        )

        const [a, b] = yield* Effect.promise(() => Promise.all([access(state, tmp.path), access(state, tmp.path)]))
        expect(a).toBe(b)
        expect(n).toBe(1)
      }),
    ),
  )
})
