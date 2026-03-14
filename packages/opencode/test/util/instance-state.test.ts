import { afterEach, expect, test } from "bun:test"
import { Duration, Effect, Layer, ManagedRuntime, ServiceMap } from "effect"

import { Instance } from "../../src/project/instance"
import { InstanceState } from "../../src/util/instance-state"
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

test("InstanceState caches values for the same instance", async () => {
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

test("InstanceState isolates values by directory", async () => {
  await using a = await tmpdir()
  await using b = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make((dir) => Effect.sync(() => ({ dir, n: ++n })))

        const x = yield* Effect.promise(() => access(state, a.path))
        const y = yield* Effect.promise(() => access(state, b.path))
        const z = yield* Effect.promise(() => access(state, a.path))

        expect(x).toBe(z)
        expect(x).not.toBe(y)
        expect(n).toBe(2)
      }),
    ),
  )
})

test("InstanceState is disposed on instance reload", async () => {
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

test("InstanceState is disposed on disposeAll", async () => {
  await using a = await tmpdir()
  await using b = await tmpdir()
  const seen: string[] = []

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make((dir) =>
          Effect.acquireRelease(
            Effect.sync(() => ({ dir })),
            (value) =>
              Effect.sync(() => {
                seen.push(value.dir)
              }),
          ),
        )

        yield* Effect.promise(() => access(state, a.path))
        yield* Effect.promise(() => access(state, b.path))
        yield* Effect.promise(() => Instance.disposeAll())

        expect(seen.sort()).toEqual([a.path, b.path].sort())
      }),
    ),
  )
})

test("InstanceState.get reads correct directory per-evaluation (not captured once)", async () => {
  await using a = await tmpdir()
  await using b = await tmpdir()

  // Regression: InstanceState.get must be lazy (Effect.suspend) so the
  // directory is read per-evaluation, not captured once at the call site.
  // Without this, a service built inside a ManagedRuntime Layer would
  // freeze to whichever directory triggered the first layer build.

  interface TestApi {
    readonly getDir: () => Effect.Effect<string>
  }

  class TestService extends ServiceMap.Service<TestService, TestApi>()("@test/ALS-lazy") {
    static readonly layer = Layer.effect(
      TestService,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((dir) => Effect.sync(() => dir))
        // `get` is created once during layer build — must be lazy
        const get = InstanceState.get(state)

        const getDir = Effect.fn("TestService.getDir")(function* () {
          return yield* get
        })

        return TestService.of({ getDir })
      }),
    )
  }

  const rt = ManagedRuntime.make(TestService.layer)

  try {
    const resultA = await Instance.provide({
      directory: a.path,
      fn: () => rt.runPromise(TestService.use((s) => s.getDir())),
    })
    expect(resultA).toBe(a.path)

    // Second call with different directory must NOT return A's directory
    const resultB = await Instance.provide({
      directory: b.path,
      fn: () => rt.runPromise(TestService.use((s) => s.getDir())),
    })
    expect(resultB).toBe(b.path)
  } finally {
    await rt.dispose()
  }
})

test("InstanceState.get isolates concurrent fibers across real delays, yields, and timer callbacks", async () => {
  await using a = await tmpdir()
  await using b = await tmpdir()
  await using c = await tmpdir()

  // Adversarial: concurrent fibers with real timer delays (macrotask
  // boundaries via setTimeout/Bun.sleep), explicit scheduler yields,
  // and many async steps. If ALS context leaks or gets lost at any
  // point, a fiber will see the wrong directory.

  interface TestApi {
    readonly getDir: () => Effect.Effect<string>
  }

  class TestService extends ServiceMap.Service<TestService, TestApi>()("@test/ALS-adversarial") {
    static readonly layer = Layer.effect(
      TestService,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((dir) => Effect.sync(() => dir))

        const getDir = Effect.fn("TestService.getDir")(function* () {
          // Mix of async boundary types to maximise interleaving:
          // 1. Real timer delay (macrotask — setTimeout under the hood)
          yield* Effect.promise(() => Bun.sleep(1))
          // 2. Effect.sleep (Effect's own timer, uses its internal scheduler)
          yield* Effect.sleep(Duration.millis(1))
          // 3. Explicit scheduler yields
          for (let i = 0; i < 100; i++) {
            yield* Effect.yieldNow
          }
          // 4. Microtask boundaries
          for (let i = 0; i < 100; i++) {
            yield* Effect.promise(() => Promise.resolve())
          }
          // 5. Another Effect.sleep
          yield* Effect.sleep(Duration.millis(2))
          // 6. Another real timer to force a second macrotask hop
          yield* Effect.promise(() => Bun.sleep(1))
          // NOW read the directory — ALS must still be correct
          return yield* InstanceState.get(state)
        })

        return TestService.of({ getDir })
      }),
    )
  }

  const rt = ManagedRuntime.make(TestService.layer)

  try {
    const [resultA, resultB, resultC] = await Promise.all([
      Instance.provide({
        directory: a.path,
        fn: () => rt.runPromise(TestService.use((s) => s.getDir())),
      }),
      Instance.provide({
        directory: b.path,
        fn: () => rt.runPromise(TestService.use((s) => s.getDir())),
      }),
      Instance.provide({
        directory: c.path,
        fn: () => rt.runPromise(TestService.use((s) => s.getDir())),
      }),
    ])

    expect(resultA).toBe(a.path)
    expect(resultB).toBe(b.path)
    expect(resultC).toBe(c.path)
  } finally {
    await rt.dispose()
  }
})

test("InstanceState dedupes concurrent lookups for the same directory", async () => {
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
