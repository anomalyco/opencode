import { expect } from "bun:test"
import { Context, Effect, Layer, Logger } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppRuntime } from "../../src/effect/app-runtime"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { makeRuntime } from "../../src/effect/run-service"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

function check(loggers: ReadonlySet<Logger.Logger<unknown, any>>) {
  return {
    defaultLogger: loggers.has(Logger.defaultLogger),
    tracerLogger: loggers.has(Logger.tracerLogger),
    effectLogger: loggers.has(EffectLogger.logger),
    size: loggers.size,
  }
}

it.live("makeRuntime installs EffectLogger through Observability.layer", () =>
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

    const current = yield* Effect.promise(() => makeRuntime(Dummy, layer).runPromise((svc) => svc.current()))

    expect(current.effectLogger).toBe(true)
    expect(current.defaultLogger).toBe(false)
  }),
)

it.live("AppRuntime also installs EffectLogger through Observability.layer", () =>
  Effect.gen(function* () {
    const current = yield* Effect.promise(() =>
      AppRuntime.runPromise(Effect.map(Effect.service(Logger.CurrentLoggers), check)),
    )

    expect(current.effectLogger).toBe(true)
    expect(current.defaultLogger).toBe(false)
  }),
)

it.live("AppRuntime attaches InstanceRef from ALS", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const current = yield* Effect.promise(() =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          return (yield* InstanceRef)?.directory
        }),
      ),
    ).pipe(provideInstance(dir))

    expect(current).toBe(dir)
  }),
)

it.live("EffectBridge preserves logger and instance context across async boundaries", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const result = yield* Effect.promise(() =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const bridge = yield* EffectBridge.make()
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
        }),
      ),
    ).pipe(provideInstance(dir))

    expect(result.directory).toBe(dir)
    expect(result.effectLogger).toBe(true)
    expect(result.defaultLogger).toBe(false)
  }),
)
