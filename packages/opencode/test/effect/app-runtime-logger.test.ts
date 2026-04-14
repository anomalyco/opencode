import { expect, test } from "bun:test"
import { Context, Effect, Layer, Logger } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { EffectLogger } from "../../src/effect/logger"
import { makeRuntime } from "../../src/effect/run-service"

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
