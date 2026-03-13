import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"

import { Instance } from "../../src/project/instance"
import { InstanceState } from "../../src/util/instance-state"
import { tmpdir } from "../fixture/fixture"

async function access<A, E>(state: InstanceState.State<A, E>, dir: string) {
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
        const state = yield* InstanceState.make({
          lookup: () => Effect.sync(() => ({ n: ++n })),
        })

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
        const state = yield* InstanceState.make({
          lookup: (dir) => Effect.sync(() => ({ dir, n: ++n })),
        })

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
        const state = yield* InstanceState.make({
          lookup: () => Effect.sync(() => ({ n: ++n })),
          release: (value) =>
            Effect.sync(() => {
              seen.push(String(value.n))
            }),
        })

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
        const state = yield* InstanceState.make({
          lookup: (dir) => Effect.sync(() => ({ dir })),
          release: (value) =>
            Effect.sync(() => {
              seen.push(value.dir)
            }),
        })

        yield* Effect.promise(() => access(state, a.path))
        yield* Effect.promise(() => access(state, b.path))
        yield* Effect.promise(() => Instance.disposeAll())

        expect(seen.sort()).toEqual([a.path, b.path].sort())
      }),
    ),
  )
})

test("InstanceState dedupes concurrent lookups for the same directory", async () => {
  await using tmp = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make({
          lookup: () =>
            Effect.promise(async () => {
              n += 1
              await Bun.sleep(10)
              return { n }
            }),
        })

        const [a, b] = yield* Effect.promise(() => Promise.all([access(state, tmp.path), access(state, tmp.path)]))
        expect(a).toBe(b)
        expect(n).toBe(1)
      }),
    ),
  )
})
