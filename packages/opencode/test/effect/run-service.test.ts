import { expect, test } from "bun:test"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRunPromise } from "../../src/effect/run-service"

class Shared extends ServiceMap.Service<Shared, { readonly id: number }>()("@test/Shared") {}

test("makeRunPromise shares dependent layers through the shared memo map", async () => {
  let n = 0

  const shared = Layer.effect(
    Shared,
    Effect.sync(() => {
      n += 1
      return Shared.of({ id: n })
    }),
  )

  class One extends ServiceMap.Service<One, { readonly get: () => Effect.Effect<number> }>()("@test/One") {}
  const one = Layer.effect(
    One,
    Effect.gen(function* () {
      const svc = yield* Shared
      return One.of({
        get: Effect.fn("One.get")(() => Effect.succeed(svc.id)),
      })
    }),
  ).pipe(Layer.provide(shared))

  class Two extends ServiceMap.Service<Two, { readonly get: () => Effect.Effect<number> }>()("@test/Two") {}
  const two = Layer.effect(
    Two,
    Effect.gen(function* () {
      const svc = yield* Shared
      return Two.of({
        get: Effect.fn("Two.get")(() => Effect.succeed(svc.id)),
      })
    }),
  ).pipe(Layer.provide(shared))

  const runOne = makeRunPromise(One, one)
  const runTwo = makeRunPromise(Two, two)

  expect(await runOne((svc) => svc.get())).toBe(1)
  expect(await runTwo((svc) => svc.get())).toBe(1)
  expect(n).toBe(1)
})
