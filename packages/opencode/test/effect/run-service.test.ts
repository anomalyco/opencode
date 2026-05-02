import { expect } from "bun:test"
import { Effect, Layer, Context } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { makeRuntime } from "../../src/effect/run-service"
import { ProjectID } from "../../src/project/schema"
import { it } from "../lib/effect"

class Shared extends Context.Service<Shared, { readonly id: number }>()("@test/Shared") {}
const testDirectory = "/tmp/opencode-test"

it.live("makeRuntime shares dependent layers through the shared memo map", () =>
  Effect.gen(function* () {
    let n = 0

    const shared = Layer.effect(
      Shared,
      Effect.sync(() => {
        n += 1
        return Shared.of({ id: n })
      }),
    )

    class One extends Context.Service<One, { readonly get: () => Effect.Effect<number> }>()("@test/One") {}
    const one = Layer.effect(
      One,
      Effect.gen(function* () {
        const svc = yield* Shared
        return One.of({
          get: Effect.fn("One.get")(() => Effect.succeed(svc.id)),
        })
      }),
    ).pipe(Layer.provide(shared))

    class Two extends Context.Service<Two, { readonly get: () => Effect.Effect<number> }>()("@test/Two") {}
    const two = Layer.effect(
      Two,
      Effect.gen(function* () {
        const svc = yield* Shared
        return Two.of({
          get: Effect.fn("Two.get")(() => Effect.succeed(svc.id)),
        })
      }),
    ).pipe(Layer.provide(shared))

    const { runPromise: runOne } = makeRuntime(One, one)
    const { runPromise: runTwo } = makeRuntime(Two, two)

    expect(yield* Effect.promise(() => runOne((svc) => svc.get()))).toBe(1)
    expect(yield* Effect.promise(() => runTwo((svc) => svc.get()))).toBe(1)
    expect(n).toBe(1)
  }),
)

it.live("makeRuntime inherits InstanceRef from the current fiber", () =>
  Effect.gen(function* () {
    class NeedsInstance extends Context.Service<
      NeedsInstance,
      { readonly directory: () => Effect.Effect<string | undefined> }
    >()("@test/NeedsInstance") {}

    const runtime = makeRuntime(
      NeedsInstance,
      Layer.succeed(
        NeedsInstance,
        NeedsInstance.of({
          directory: () =>
            Effect.gen(function* () {
              return (yield* InstanceRef)?.directory
            }),
        }),
      ),
    )

    const actual = yield* Effect.promise(() => runtime.runPromise((svc) => svc.directory()))

    expect(actual).toBe(testDirectory)
  }).pipe(
    Effect.provideService(InstanceRef, {
      directory: testDirectory,
      worktree: testDirectory,
      project: {
        id: ProjectID.global,
        worktree: testDirectory,
        time: { created: 0, updated: 0 },
        sandboxes: [],
      },
    }),
  ),
)
