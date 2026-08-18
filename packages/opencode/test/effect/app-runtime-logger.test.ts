import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Deferred, Effect, Fiber, Layer, Logger } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppLayer } from "../../src/effect/app-runtime"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as Observability from "@opencode-ai/core/observability"
import { attach } from "../../src/effect/run-service"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const observabilityLayer = LayerNode.compile(Observability.node)
const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

function check(loggers: ReadonlySet<Logger.Logger<unknown, any>>) {
  return {
    tracerLogger: loggers.has(Logger.tracerLogger),
    size: loggers.size,
  }
}

it.live("makeRuntime installs the observability logger", () =>
  Effect.gen(function* () {
    class Dummy extends Context.Service<Dummy, { readonly current: () => Effect.Effect<ReturnType<typeof check>> }>()(
      "@test/Dummy",
    ) {}

    const layer = Layer.effect(
      Dummy,
      Effect.gen(function* () {
        return Dummy.of({
          current: () => Effect.map(Effect.service(Logger.CurrentLoggers), check),
        })
      }),
    )

    const current = yield* Dummy.use((svc) => svc.current()).pipe(
      Effect.provide(Layer.provideMerge(layer, observabilityLayer)),
    )

    expect(current.size).toBeGreaterThan(0)
  }),
)

it.live("AppLayer also installs the observability logger", () =>
  Effect.gen(function* () {
    const current = yield* Effect.map(Effect.service(Logger.CurrentLoggers), check).pipe(Effect.provide(AppLayer))

    expect(current.size).toBeGreaterThan(0)
  }),
)

it.instance(
  "attach preserves InstanceRef from the current fiber context",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const current = yield* attach(
        Effect.gen(function* () {
          return (yield* InstanceRef)?.directory
        }),
      )

      expect(current).toBe(test.directory)
    }),
  { git: true },
)

it.instance(
  "EffectBridge preserves logger and instance context across async boundaries",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const bridge = yield* EffectBridge.make()
      const started = yield* Deferred.make<void>()

      const fiber = yield* Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        return yield* Effect.promise(() =>
          Promise.resolve().then(() =>
            bridge.promise(
              Effect.gen(function* () {
                return {
                  directory: (yield* InstanceRef)?.directory,
                  ...check(yield* Effect.service(Logger.CurrentLoggers)),
                }
              }),
            ),
          ),
        )
      }).pipe(Effect.forkScoped)

      yield* Deferred.await(started)
      const result = yield* Fiber.join(fiber)

      expect(result.directory).toBe(test.directory)
      expect(result.size).toBeGreaterThan(0)
    }).pipe(Effect.provide(observabilityLayer)),
  { git: true },
)
