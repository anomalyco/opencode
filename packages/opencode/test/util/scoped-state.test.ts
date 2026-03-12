import { expect, test } from "bun:test"
import { Effect, Fiber } from "effect"

import * as ScopedState from "../../src/util/scoped-state"

test("ScopedState caches values for the current root", async () => {
  let key = "a"
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* ScopedState.make({
          root: () => key,
          lookup: () => Effect.sync(() => ({ n: ++n })),
        })

        const a = yield* ScopedState.get(state)
        const b = yield* ScopedState.get(state)

        expect(a).toBe(b)
        expect(n).toBe(1)
      }),
    ),
  )
})

test("ScopedState isolates values by root", async () => {
  let key = "a"
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* ScopedState.make({
          root: () => key,
          lookup: (root) => Effect.sync(() => ({ root, n: ++n })),
        })

        const a = yield* ScopedState.get(state)
        key = "b"
        const b = yield* ScopedState.get(state)
        key = "a"
        const a2 = yield* ScopedState.get(state)

        expect(a).toBe(a2)
        expect(a).not.toBe(b)
        expect(n).toBe(2)
      }),
    ),
  )
})

test("ScopedState.invalidate refreshes the current root", async () => {
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* ScopedState.make({
          root: () => "a",
          lookup: () => Effect.sync(() => ({ n: ++n })),
        })

        const a = yield* ScopedState.get(state)
        yield* ScopedState.invalidate(state)
        const b = yield* ScopedState.get(state)

        expect(a).not.toBe(b)
        expect(n).toBe(2)
      }),
    ),
  )
})

test("ScopedState.invalidateAt only refreshes the targeted root", async () => {
  let key = "a"
  let n = 0
  const seen: string[] = []

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* ScopedState.make({
          root: () => key,
          lookup: (root) => Effect.sync(() => ({ root, n: ++n })),
          release: (value, root) =>
            Effect.sync(() => {
              seen.push(`${root}:${value.n}`)
            }),
        })

        const a = yield* ScopedState.get(state)
        key = "b"
        const b = yield* ScopedState.get(state)
        yield* ScopedState.invalidateAt(state, "a")
        key = "a"
        const a2 = yield* ScopedState.get(state)
        key = "b"
        const b2 = yield* ScopedState.get(state)

        expect(a).not.toBe(a2)
        expect(b).toBe(b2)
        expect(seen).toEqual(["a:1"])
      }),
    ),
  )
})

test("ScopedState dedupes concurrent lookups for the same root", async () => {
  const gate = Promise.withResolvers<void>()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* ScopedState.make({
          root: () => "a",
          lookup: () =>
            Effect.promise(async () => {
              n += 1
              await gate.promise
              return { n }
            }),
        })

        const fiber = yield* Effect.all([ScopedState.get(state), ScopedState.get(state)], { concurrency: 2 }).pipe(
          Effect.forkChild({ startImmediately: true }),
        )

        yield* Effect.promise(() => Promise.resolve())
        expect(n).toBe(1)

        gate.resolve()
        const [a, b] = yield* Fiber.join(fiber)
        expect(a).toBe(b)
      }),
    ),
  )
})

test("ScopedState runs release when the surrounding scope closes", async () => {
  const seen: string[] = []

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* ScopedState.make({
          root: () => "a",
          lookup: (root) => Effect.sync(() => ({ root })),
          release: (value, root) =>
            Effect.sync(() => {
              seen.push(`${root}:${value.root}`)
            }),
        })

        yield* ScopedState.get(state)
        yield* ScopedState.getAt(state, "b")
      }),
    ),
  )

  expect(seen.sort()).toEqual(["a:a", "b:b"])
})
