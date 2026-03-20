import { describe, expect, test } from "bun:test"
import { Effect, Layer, LayerMap, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"

/**
 * These tests verify the lifecycle semantics of the LayerMap-based runtime.
 *
 * We model three services:
 *
 * - `Global`: process-wide, provided directly in the main runtime layer
 * - `B`: instance-scoped, depends on `Global`
 * - `A`: instance-scoped, depends on both `B` and `Global`
 *
 * Instance services are composed into a single layer per directory via a
 * LayerMap lookup function — mirroring `instances.ts`. Each instance service
 * layer has `.pipe(Layer.fresh)` applied at its definition site so it is
 * always rebuilt per directory, while shared dependencies (Global, platform
 * layers) are provided outside the fresh boundary and remain memoizable.
 *
 * The key invariant: within a single directory, A and B share the same
 * instance of B — it is never rebuilt.
 */
function mk() {
  const seen = {
    globalStart: 0,
    globalEnd: 0,
    bStart: 0,
    bEnd: 0,
    aStart: 0,
    aEnd: 0,
  }

  let id = 0
  const next = () => ++id

  class Global extends ServiceMap.Service<Global, { readonly id: number }>()("@test/runtime/global") {}
  class B extends ServiceMap.Service<B, { readonly id: number; readonly global: number }>()("@test/runtime/b") {}
  class A extends ServiceMap.Service<A, { readonly id: number; readonly b: number; readonly global: number }>()(
    "@test/runtime/a",
  ) {}

  type InstanceServices = A["Service"] | B["Service"]

  const globalLayer = Layer.effect(
    Global,
    Effect.acquireRelease(
      Effect.sync(() => {
        seen.globalStart += 1
        return Global.of({ id: next() })
      }),
      () =>
        Effect.sync(() => {
          seen.globalEnd += 1
        }),
    ),
  )

  // B depends on Global — .pipe(Layer.fresh) at the definition site,
  // just like the real instance service modules.
  const bLayer = Layer.effect(
    B,
    Effect.gen(function* () {
      const global = yield* Global
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          seen.bStart += 1
          return B.of({ id: next(), global: global.id })
        }),
        () =>
          Effect.sync(() => {
            seen.bEnd += 1
          }),
      )
    }),
  ).pipe(Layer.fresh)

  // A depends on B and Global — also .pipe(Layer.fresh).
  const aLayer = Layer.effect(
    A,
    Effect.gen(function* () {
      const global = yield* Global
      const b = yield* B
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          seen.aStart += 1
          return A.of({ id: next(), b: b.id, global: global.id })
        }),
        () =>
          Effect.sync(() => {
            seen.aEnd += 1
          }),
      )
    }),
  ).pipe(Layer.fresh)

  // Mirrors instances.ts: lookup composes all instance services for one
  // directory. Layer.provideMerge wires B's output into A's context AND
  // merges both outputs, so B is built exactly once per directory.
  // No Layer.fresh here — it's already on each layer.
  function lookup(_key: string) {
    return Layer.provideMerge(aLayer, bLayer).pipe(Layer.provide(globalLayer))
  }

  const instancesLayer = Layer.effect(
    Instances,
    Effect.gen(function* () {
      const layerMap = yield* LayerMap.make(lookup, { idleTimeToLive: Infinity })
      return Instances.of(layerMap)
    }),
  )

  const rt = ManagedRuntime.make(Layer.mergeAll(globalLayer, instancesLayer))

  return { seen, rt, Global, B, A, Instances }
}

class Instances extends ServiceMap.Service<Instances, LayerMap.LayerMap<string, any>>()("@test/runtime/instances") {
  static get(directory: string) {
    return Layer.unwrap(Instances.use((map) => Effect.succeed(map.get(directory))))
  }
}

describe("effect/runtime (LayerMap)", () => {
  test("global services are instantiated exactly once", async () => {
    const { seen, rt, Global } = mk()

    const first = await rt.runPromise(Global.use((svc) => Effect.succeed(svc.id)))
    const second = await rt.runPromise(Global.use((svc) => Effect.succeed(svc.id)))

    expect(first).toBe(second)
    expect(seen.globalStart).toBe(1)

    await rt.dispose()

    expect(seen.globalEnd).toBe(1)
  })

  test("instance services are reused within a directory but isolated across directories", async () => {
    const { seen, rt, B } = mk()

    const first = await rt.runPromise(
      B.use((svc) => Effect.succeed({ id: svc.id, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-one")),
      ),
    )

    const firstAgain = await rt.runPromise(
      B.use((svc) => Effect.succeed({ id: svc.id, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-one")),
      ),
    )

    // Same directory, same B.
    expect(first).toEqual(firstAgain)
    expect(seen.bStart).toBe(1)
    expect(seen.globalStart).toBe(1)

    // Different directory → new B, same Global.
    const second = await rt.runPromise(
      B.use((svc) => Effect.succeed({ id: svc.id, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-two")),
      ),
    )

    expect(second.id).not.toBe(first.id)
    expect(second.global).toBe(first.global)
    expect(seen.bStart).toBe(2)
    expect(seen.globalStart).toBe(1)

    await rt.dispose()

    expect(seen.bEnd).toBe(2)
    expect(seen.globalEnd).toBe(1)
  })

  test("A reuses the already-running B from the same directory", async () => {
    const { seen, rt, A, B } = mk()

    // Step 1: access B in dir-one.
    const b = await rt.runPromise(
      B.use((svc) => Effect.succeed({ id: svc.id, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-one")),
      ),
    )

    expect(seen.bStart).toBe(1)
    expect(seen.globalStart).toBe(1)

    // Step 2: access A in the same directory.
    // A depends on B — it should pick up the SAME B instance, not rebuild it.
    const a = await rt.runPromise(
      A.use((svc) => Effect.succeed({ id: svc.id, b: svc.b, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-one")),
      ),
    )

    expect(a.b).toBe(b.id)
    expect(a.global).toBe(b.global)
    expect(seen.bStart).toBe(1) // B was NOT rebuilt
    expect(seen.aStart).toBe(1)
    expect(seen.globalStart).toBe(1)

    await rt.dispose()

    // One instance of each, one release of each.
    expect(seen.globalEnd).toBe(1)
    expect(seen.bEnd).toBe(1)
    expect(seen.aEnd).toBe(1)
  })

  test("instance disposal does not tear down global services", async () => {
    const { seen, rt, Global, B } = mk()

    // Ensure global is built.
    const globalId = await rt.runPromise(Global.use((svc) => Effect.succeed(svc.id)))
    expect(seen.globalStart).toBe(1)

    // Build B for dir-one.
    const first = await rt.runPromise(
      B.use((svc) => Effect.succeed({ id: svc.id, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-one")),
      ),
    )
    expect(first.global).toBe(globalId)
    expect(seen.bStart).toBe(1)

    // Invalidate dir-one (equivalent to Instance.dispose).
    await rt.runPromise(Instances.use((map) => map.invalidate("dir-one")))

    expect(seen.bEnd).toBe(1)
    expect(seen.globalEnd).toBe(0) // Global survives

    // Re-access B for dir-one → rebuilt, but Global is still the same.
    const second = await rt.runPromise(
      B.use((svc) => Effect.succeed({ id: svc.id, global: svc.global })).pipe(
        Effect.provide(Instances.get("dir-one")),
      ),
    )

    expect(second.id).not.toBe(first.id)
    expect(second.global).toBe(first.global)
    expect(seen.bStart).toBe(2)
    expect(seen.globalStart).toBe(1)

    await rt.dispose()
  })
})
