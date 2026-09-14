export * as Shutdown from "./shutdown"

import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly add: (effect: Effect.Effect<void>) => Effect.Effect<() => void>
  readonly run: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Shutdown") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const effects = new Set<Effect.Effect<void>>()
    const run = yield* Effect.cached(
      Effect.suspend(() => Effect.forEach(effects, (effect) => effect, { concurrency: "unbounded", discard: true })),
    )
    return Service.of({
      add: (effect) =>
        Effect.sync(() => {
          effects.add(effect)
          return () => effects.delete(effect)
        }),
      run,
    })
  }),
)
