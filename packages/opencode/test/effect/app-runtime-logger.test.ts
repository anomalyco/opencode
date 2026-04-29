import { expect, test } from "bun:test"
import { Context, Effect, Layer, Logger } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { makeRuntime } from "../../src/effect/run-service"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function check(loggers: ReadonlySet<Logger.Logger<unknown, any>>) {
  return {
    defaultLogger: loggers.has(Logger.defaultLogger),
    tracerLogger: loggers.has(Logger.tracerLogger),
    effectLogger: loggers.has(EffectLogger.logger),
    size: loggers.size,
  }
}

test("makeRuntime installs EffectLogger through Observability.layer", async () => {
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

  const rt = makeRuntime(Dummy, layer)
  const current = await rt.runPromise((svc) => svc.current())

  expect(current.effectLogger).toBe(true)
  expect(current.defaultLogger).toBe(false)
})

test("AppRuntime also installs EffectLogger through Observability.layer", async () => {
  const current = await AppRuntime.runPromise(Effect.map(Effect.service(Logger.CurrentLoggers), check))

  expect(current.effectLogger).toBe(true)
  expect(current.defaultLogger).toBe(false)
})

test("AppRuntime attaches InstanceRef from ALS", async () => {
  await using tmp = await tmpdir({ git: true })

  const dir = await Instance.provide({
    directory: tmp.path,
    fn: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          return (yield* InstanceRef)?.directory
        }),
      ),
  })

  expect(dir).toBe(tmp.path)
})

test("EffectBridge preserves logger and instance context across async boundaries", async () => {
  await using tmp = await tmpdir({ git: true })

  const result = await Instance.provide({
    directory: tmp.path,
    fn: () =>
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
  })

  expect(result.directory).toBe(tmp.path)
  expect(result.effectLogger).toBe(true)
  expect(result.defaultLogger).toBe(false)
})
