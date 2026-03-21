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
  await using one = await tmpdir()
  await using two = await tmpdir()
  await using three = await tmpdir()

  interface Api {
    readonly get: () => Effect.Effect<string>
  }

  class Test extends ServiceMap.Service<Test, Api>()("@test/InstanceStateAsync") {
    static readonly layer = Layer.effect(
      Test,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))

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

    expect(a).toBe(one.path)
    expect(b).toBe(two.path)
    expect(c).toBe(three.path)
  } finally {
    await rt.dispose()
  }
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
