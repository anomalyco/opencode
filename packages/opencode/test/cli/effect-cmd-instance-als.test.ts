import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { Instance } from "../../src/project/instance"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.void }),
)

const it = testEffect(
  Layer.mergeAll(InstanceStore.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(noopBootstrap)),
)

afterEach(async () => {
  await disposeAllInstances()
})

// Reproduces the regression from PR #25522: when an effectCmd handler does
// `yield* Effect.promise(async () => { ... await someRunPromise(svcMethod) ... })`,
// the inner runPromise creates a fresh fiber after `await` whose context lacks
// the outer InstanceRef. Services that read `InstanceState.context` then fall
// back to `Instance.current` ALS — which must still be set by effectCmd.
describe("effectCmd Instance.current ALS bridge", () => {
  it.live("preserves Instance.current ALS across Effect.promise(async) → runPromise re-entry", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* store.load({ directory: dir })

      // Mimic effectCmd: install ALS, then run the body via runPromise.
      const inner = Effect.gen(function* () {
        // First, prove Effect-level InstanceRef is provided on the synchronous path.
        const fromRef = yield* InstanceRef
        expect(fromRef?.directory).toBe(dir)

        // Now cross into Effect.promise(async) and re-enter Effect from the async closure.
        // The inner runPromise gets a fresh fiber whose context has InstanceRef = undefined.
        // Without the ALS bridge, Instance.current would throw — and any service that
        // yields InstanceState.context would die with LocalContext.NotFound.
        yield* Effect.promise(async () => {
          await new Promise((r) => setTimeout(r, 5))
          const current = await Effect.runPromise(
            Effect.sync(() => {
              try {
                return Instance.current
              } catch {
                return undefined
              }
            }),
          )
          expect(current?.directory).toBe(dir)
        })
      }).pipe(Effect.provideService(InstanceRef, ctx))

      // SANITY: replace the next line with `yield* Effect.promise(() => Effect.runPromise(inner))`
      // (no Instance.restore) and the test must fail with `current?.directory` undefined.
      yield* Effect.promise(() => Instance.restore(ctx, () => Effect.runPromise(inner)))
    }),
  )
})
